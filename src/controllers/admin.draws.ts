import { ApplicationStatus, DrawStatus, PaymentStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { asyncHandler, HttpError } from "../utils/http";

export const createDrawSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2).max(120),
    maxParticipants: z.coerce.number().int().positive().optional(),
    makeActive: z.boolean().optional().default(true)
  })
});

export const updateDrawControlSchema = z.object({
  body: z.object({
    appControlStatus: z.enum(["open", "paused", "closed"]),
    bannerMessage: z.string().trim().max(500).optional()
  })
});

export const updateApplicationLimitSchema = z.object({
  body: z.object({
    // 0 means unlimited; a positive value is a per-account family cap.
    maxApplicationsPerUser: z.coerce.number().int().min(0).max(100)
  })
});

export const updateApplicantStatusSchema = z.object({
  body: z.object({
    applicationId: z.string().cuid(),
    status: z.nativeEnum(ApplicationStatus)
  })
});

export const declareWinnersSchema = z.object({
  body: z.object({
    drawId: z.string().cuid(),
    winnerIds: z.array(z.string().cuid()).min(1),
    waitingListIds: z.array(z.string().cuid()).optional().default([])
  })
});

export const listDraws = asyncHandler(async (_req, res) => {
  const draws = await prisma.draw.findMany({
    orderBy: { drawIndex: "desc" },
    include: {
      result: true,
      _count: {
        select: {
          applications: true
        }
      }
    }
  });

  // Calculate detailed stats per draw
  const detailedDraws = await Promise.all(
    draws.map(async (draw) => {
      const [paidCount, verifiedCount, approvedCount, winnerCount, waitingCount] = await Promise.all([
        prisma.application.count({ where: { drawId: draw.id, paymentStatus: PaymentStatus.paid } }),
        prisma.application.count({ where: { drawId: draw.id, status: ApplicationStatus.verified } }),
        prisma.application.count({ where: { drawId: draw.id, status: ApplicationStatus.approved } }),
        prisma.application.count({ where: { drawId: draw.id, status: ApplicationStatus.winner } }),
        prisma.application.count({ where: { drawId: draw.id, status: ApplicationStatus.waiting_list } })
      ]);

      return {
        ...draw,
        totalApplications: draw._count.applications,
        paidApplications: paidCount,
        verifiedApplications: verifiedCount,
        approvedApplications: approvedCount,
        winnerApplications: winnerCount,
        waitingApplications: waitingCount
      };
    })
  );

  res.json({ success: true, data: detailedDraws });
});

export const createDraw = asyncHandler(async (req, res) => {
  const { name, maxParticipants, makeActive } = req.body;

  // Determine next drawIndex
  const highestDraw = await prisma.draw.findFirst({
    orderBy: { drawIndex: "desc" },
    select: { drawIndex: true }
  });

  const nextIndex = highestDraw ? highestDraw.drawIndex + 1 : 0;

  if (makeActive) {
    // Transition all active draws to closed
    await prisma.draw.updateMany({
      where: { status: DrawStatus.active },
      data: { status: DrawStatus.closed }
    });
  }

  const newDraw = await prisma.draw.create({
    data: {
      name,
      drawIndex: nextIndex,
      status: makeActive ? DrawStatus.active : DrawStatus.draft,
      appControlStatus: "open",
      maxParticipants: maxParticipants ?? null,
      startDate: new Date()
    }
  });

  res.status(201).json({ success: true, data: newDraw });
});

export const setActiveDraw = asyncHandler(async (req, res) => {
  const drawId = req.params.id;

  const targetDraw = await prisma.draw.findUnique({ where: { id: drawId } });
  if (!targetDraw) {
    throw new HttpError(404, "Draw not found");
  }

  // Deactivate all current active draws
  await prisma.draw.updateMany({
    where: { status: DrawStatus.active },
    data: { status: DrawStatus.closed }
  });

  // Activate target draw
  const updatedDraw = await prisma.draw.update({
    where: { id: drawId },
    data: { status: DrawStatus.active }
  });

  res.json({ success: true, data: updatedDraw });
});

export const updateDrawStatus = asyncHandler(async (req, res) => {
  const drawId = req.params.id;
  const { status } = req.body as { status: DrawStatus };

  if (!Object.values(DrawStatus).includes(status)) {
    throw new HttpError(400, "Invalid draw status");
  }

  const updated = await prisma.draw.update({
    where: { id: drawId },
    data: {
      status,
      ...(status === DrawStatus.closed ? { endDate: new Date(), appControlStatus: "closed" } : {})
    }
  });

  if (status === DrawStatus.closed) {
    try {
      await performDrawBackup(drawId, "automatic_draw_close");
    } catch (err) {
      console.error("Automated draw backup on close failed:", err);
    }
  }

  res.json({ success: true, data: updated });
});

export const updateApplicationControl = asyncHandler(async (req, res) => {
  const drawId = req.params.id;
  const { appControlStatus, bannerMessage } = req.body;

  const updated = await prisma.draw.update({
    where: { id: drawId },
    data: {
      appControlStatus,
      bannerMessage: bannerMessage || null
    }
  });

  res.json({ success: true, data: updated });
});

export const updateApplicationLimit = asyncHandler(async (req, res) => {
  const updated = await prisma.draw.update({
    where: { id: req.params.id },
    data: { maxApplicationsPerUser: req.body.maxApplicationsPerUser }
  });
  res.json({ success: true, data: updated });
});

export const updateApplicantStatus = asyncHandler(async (req, res) => {
  const { applicationId, status } = req.body;

  const updated = await prisma.application.update({
    where: { id: applicationId },
    data: { status },
    include: {
      user: { select: { name: true, email: true } },
      draw: { select: { name: true } }
    }
  });

  res.json({ success: true, data: updated });
});

export const declareWinners = asyncHandler(async (req, res) => {
  const { drawId, winnerIds, waitingListIds } = req.body;

  const draw = await prisma.draw.findUnique({ where: { id: drawId } });
  if (!draw) {
    throw new HttpError(404, "Draw not found");
  }

  // Update winners
  await prisma.application.updateMany({
    where: { id: { in: winnerIds }, drawId },
    data: { status: ApplicationStatus.winner }
  });

  // Update waiting list
  if (waitingListIds.length > 0) {
    await prisma.application.updateMany({
      where: { id: { in: waitingListIds }, drawId },
      data: { status: ApplicationStatus.waiting_list }
    });
  }

  // Create or update DrawResult
  const totalUsers = await prisma.application.count({ where: { drawId } });
  const selectedCount = winnerIds.length;
  const percentage = totalUsers > 0 ? (selectedCount / totalUsers) * 100 : 0;

  await prisma.drawResult.upsert({
    where: { drawId },
    update: { totalUsers, selectedCount, percentage },
    create: { drawId, totalUsers, selectedCount, percentage }
  });

  res.json({ success: true, message: "Winners and waiting list updated successfully" });
});

export const getPublicWinners = asyncHandler(async (req, res) => {
  const drawId = req.query.drawId as string;

  const whereClause = drawId 
    ? { drawId, status: { in: [ApplicationStatus.winner, ApplicationStatus.waiting_list, ApplicationStatus.selected] } }
    : { status: { in: [ApplicationStatus.winner, ApplicationStatus.waiting_list, ApplicationStatus.selected] } };

  const winners = await prisma.application.findMany({
    where: whereClause,
    include: {
      user: { select: { name: true, email: true } },
      draw: { select: { name: true, drawIndex: true, status: true } }
    },
    orderBy: { updatedAt: "desc" }
  });

  res.json({ success: true, data: winners });
});

export const bulkMarkNotSelected = asyncHandler(async (req, res) => {
  const drawId = req.params.id;

  const draw = await prisma.draw.findUnique({ where: { id: drawId } });
  if (!draw) {
    throw new HttpError(404, "Draw not found");
  }

  const result = await prisma.application.updateMany({
    where: {
      drawId,
      status: { notIn: [ApplicationStatus.selected, ApplicationStatus.winner] }
    },
    data: { status: ApplicationStatus.not_selected }
  });

  res.json({
    success: true,
    message: `Updated ${result.count} applications to 'Not Selected'`,
    data: { count: result.count }
  });
});

export async function performDrawBackup(drawId: string, reason: string = "manual") {
  const draw = await prisma.draw.findUnique({
    where: { id: drawId },
    include: {
      result: true,
      applications: {
        include: {
          user: { select: { id: true, name: true, email: true } },
          receipt: true
        }
      }
    }
  });

  if (!draw) {
    throw new HttpError(404, "Draw not found for backup");
  }

  const paidApplications = draw.applications.filter((a) => a.paymentStatus === PaymentStatus.paid).length;
  const winnerApplications = draw.applications.filter(
    (a) => a.status === ApplicationStatus.winner || a.status === ApplicationStatus.selected
  ).length;

  const snapshotData = {
    drawId: draw.id,
    drawName: draw.name,
    drawIndex: draw.drawIndex,
    status: draw.status,
    appControlStatus: draw.appControlStatus,
    startDate: draw.startDate,
    endDate: draw.endDate,
    backedUpAt: new Date().toISOString(),
    totalApplications: draw.applications.length,
    paidApplications,
    winnerApplications,
    drawResult: draw.result,
    applications: draw.applications.map((app) => ({
      id: app.id,
      registrationNo: app.registrationNo,
      userId: app.userId,
      userName: app.applicantName || app.user?.name,
      userEmail: app.user?.email,
      phone: app.phone,
      stateCode: app.stateCode,
      stateName: app.stateName,
      city: app.city,
      address: app.address,
      entryFee: app.entryFee,
      status: app.status,
      paymentStatus: app.paymentStatus,
      paymentId: app.paymentId,
      orderId: app.orderId,
      createdAt: app.createdAt,
      receiptNo: app.receipt?.receiptNo
    }))
  };

  const backup = await prisma.drawBackup.create({
    data: {
      drawId: draw.id,
      drawName: draw.name,
      drawIndex: draw.drawIndex,
      totalApplications: draw.applications.length,
      paidApplications,
      winnerApplications,
      snapshotData,
      backupReason: reason
    }
  });

  return backup;
}

export const createBackupForDraw = asyncHandler(async (req, res) => {
  const drawId = req.params.id;
  const { reason } = req.body || {};
  const backup = await performDrawBackup(drawId, reason || "manual_admin");
  res.status(201).json({ success: true, message: "Draw backup created successfully", data: backup });
});

export const listDrawBackups = asyncHandler(async (req, res) => {
  const drawId = req.query.drawId as string | undefined;
  const backups = await prisma.drawBackup.findMany({
    where: drawId ? { drawId } : undefined,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      drawId: true,
      drawName: true,
      drawIndex: true,
      totalApplications: true,
      paidApplications: true,
      winnerApplications: true,
      backupReason: true,
      createdAt: true
    }
  });
  res.json({ success: true, data: backups });
});

export const getDrawBackupDetail = asyncHandler(async (req, res) => {
  const backupId = req.params.id;
  const backup = await prisma.drawBackup.findUnique({ where: { id: backupId } });
  if (!backup) {
    throw new HttpError(404, "Backup record not found");
  }
  res.json({ success: true, data: backup });
});
