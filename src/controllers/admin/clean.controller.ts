import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { asyncHandler, HttpError } from "../../utils/http";
import { logAdminAction } from "../../services/audit.service";
import { logEvent } from "../../utils/logger";

export const factoryResetSchema = z.object({
  body: z.object({ confirmation: z.literal("FACTORY RESET") })
});

export const cleanDatabaseHandler = asyncHandler(async (req: Request, res: Response) => {
  if (req.body?.confirmation !== "FACTORY RESET") {
    throw new HttpError(400, 'Type "FACTORY RESET" to confirm this irreversible action.');
  }
  const result = await prisma.$transaction(async (tx) => {
    // Only draw lifecycle data is erased. Accounts, settings, content and donations are preserved.
    const deletedReceipts = await tx.paymentReceipt.deleteMany({});
    const deletedApps = await tx.application.deleteMany({});
    const deletedDrawResults = await tx.drawResult.deleteMany({});
    const deletedDrawBackups = await tx.drawBackup.deleteMany({});
    const deletedDraws = await tx.draw.deleteMany({});

    // 3. Reset registration counter
    await tx.registrationCounter.upsert({
      where: { id: 1 },
      update: { counter: 100000 },
      create: { id: 1, counter: 100000 }
    });

    return {
      deletedReceipts: deletedReceipts.count,
      deletedApps: deletedApps.count,
      deletedDrawResults: deletedDrawResults.count,
      deletedDrawBackups: deletedDrawBackups.count,
      deletedDraws: deletedDraws.count
    };
  });

  if (req.user?.id) {
    await logAdminAction(req.user.id, "FACTORY_RESET", "System", undefined, result);
  }
  logEvent("FACTORY_RESET", { adminId: req.user?.id, ...result, counter: 100000 });

  res.json({
    success: true,
    message: "Draw lifecycle data was reset successfully. Accounts and site content were preserved.",
    data: result
  });
});
