import { z } from "zod";
import { asyncHandler, HttpError } from "../../utils/http";
import { prisma } from "../../config/prisma";
import { createDraw, changeDrawStatus } from "../../services/draw-manager.service";
import { runLuckyDraw } from "../../services/draw.service";
import { DrawStatus } from "@prisma/client";
import { logAdminAction } from "../../services/audit.service";
import { logEvent } from "../../utils/logger";

export const drawSchema = z.object({
  body: z.object({
    name: z.string().trim().min(3),
    maxParticipants: z.coerce.number().positive().optional(),
    maxApplicationsPerUser: z.coerce.number().int().min(0).max(100).optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional()
  })
});

export const runDrawSchema = z.object({
  body: z.object({
    drawId: z.string().min(1),
    mode: z.enum(["fixed", "percentage"]).default("fixed"),
    fixedCount: z.coerce.number().int().positive().max(100000).default(125),
    percentage: z.coerce.number().positive().max(100).default(1.01)
  })
});

export const listDraws = asyncHandler(async (_req, res) => {
  const draws = await prisma.draw.findMany({
    orderBy: { createdAt: "desc" },
    include: { result: true, _count: { select: { applications: true } } }
  });
  res.json({ success: true, data: draws });
});

export const createNewDraw = asyncHandler(async (req, res) => {
  const draw = await createDraw({
    name: req.body.name,
    maxParticipants: req.body.maxParticipants,
    maxApplicationsPerUser: req.body.maxApplicationsPerUser,
    startDate: req.body.startDate ? new Date(req.body.startDate) : undefined,
    endDate: req.body.endDate ? new Date(req.body.endDate) : undefined
  });

  await logAdminAction(req.user!.id, "CREATE_DRAW", "Draw", draw.id, req.body);
  res.status(201).json({ success: true, data: draw });
});

export const updateDrawStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!Object.values(DrawStatus).includes(status)) {
    throw new HttpError(400, "Invalid draw status");
  }

  const updated = await changeDrawStatus(id, status as DrawStatus);
  await logAdminAction(req.user!.id, "UPDATE_DRAW_STATUS", "Draw", id, { status });
  
  res.json({ success: true, data: updated });
});

export const executeDraw = asyncHandler(async (req, res) => {
  const { drawId, mode, fixedCount, percentage } = req.body;

  const result = await runLuckyDraw({
    drawId,
    fixedCount: mode === "fixed" ? fixedCount : undefined,
    percentage: mode === "percentage" ? percentage : undefined
  });

  await logAdminAction(req.user!.id, "EXECUTE_DRAW", "Draw", drawId, req.body);
  res.status(201).json({ success: true, data: result });
});

export const getDrawHistory = asyncHandler(async (_req, res) => {
  const completedDraws = await prisma.draw.findMany({
    where: {
      OR: [
        { status: "closed" },
        { status: "archived" },
        { result: { isNot: null } }
      ]
    },
    orderBy: { updatedAt: "desc" },
    include: {
      result: true,
      applications: {
        where: { status: "selected" },
        select: {
          id: true,
          registrationNo: true,
          applicantName: true,
          phone: true,
          city: true,
          stateName: true,
          status: true,
          paymentStatus: true,
          createdAt: true,
          user: { select: { name: true, email: true } }
        }
      }
    }
  });

  const history = completedDraws.map((draw) => ({
    drawId: draw.id,
    drawName: draw.name,
    drawIndex: draw.drawIndex,
    drawStatus: draw.status,
    eventDate: draw.startDate,
    closingDate: draw.endDate || draw.updatedAt,
    totalApplicants: draw.result?.totalUsers || 0,
    selectedCount: draw.result?.selectedCount || draw.applications.length,
    selectionTimestamp: draw.result?.createdAt || draw.updatedAt,
    winners: draw.applications.map((app) => ({
      registrationNo: app.registrationNo,
      applicantName: app.applicantName || app.user?.name || "Participant",
      email: app.user?.email,
      phone: app.phone,
      city: app.city,
      stateName: app.stateName,
      status: app.status,
      ticketNumber: app.registrationNo
    })),
    runnerUps: []
  }));

  res.json({ success: true, data: history });
});

export const deleteDraw = asyncHandler(async (req, res) => {
  const drawId = req.params.id;

  const draw = await prisma.draw.findUnique({ where: { id: drawId } });
  if (!draw) {
    throw new HttpError(404, "Draw not found");
  }

  const result = await prisma.$transaction(async (tx) => {
    // 1. Delete associated DrawResult
    await tx.drawResult.deleteMany({ where: { drawId } });

    // 2. Delete associated DrawBackup
    await tx.drawBackup.deleteMany({ where: { drawId } });

    // 3. Delete associated Applications (and their PaymentReceipts via cascade)
    const deletedApps = await tx.application.deleteMany({ where: { drawId } });

    // 4. Delete the Draw record itself
    await tx.draw.delete({ where: { id: drawId } });

    // 5. Rollback registration counter to the maximum numeric registrationNo among remaining applications
    const remainingApps = await tx.application.findMany({
      where: { registrationNo: { startsWith: "NHCF" } },
      select: { registrationNo: true }
    });

    let maxCounter = 100000;
    for (const app of remainingApps) {
      const num = parseInt(app.registrationNo.replace(/^NHCF/i, ""), 10);
      if (!Number.isNaN(num)) {
        if (num > maxCounter) {
          maxCounter = num;
        }
      }
    }

    await tx.registrationCounter.upsert({
      where: { id: 1 },
      update: { counter: maxCounter },
      create: { id: 1, counter: maxCounter }
    });

    return {
      deletedApplicationsCount: deletedApps.count,
      newCounter: maxCounter
    };
  });

  if (req.user?.id) {
    await logAdminAction(req.user.id, "DELETE_DRAW", "Draw", drawId, {
      drawName: draw.name,
      drawIndex: draw.drawIndex,
      ...result
    });
  }
  logEvent("DRAW_DELETE", { drawId, drawName: draw.name, deletedApplications: result.deletedApplicationsCount, newCounter: result.newCounter });

  res.json({
    success: true,
    message: `Draw '${draw.name}' deleted successfully along with ${result.deletedApplicationsCount} applicants. Registration counter rolled back to ${result.newCounter}.`,
    data: result
  });
});
