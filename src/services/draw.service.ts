import crypto from "crypto";
import { ApplicationStatus, PaymentStatus, Prisma, DrawStatus } from "@prisma/client";
import { prisma } from "../config/prisma";
import { HttpError } from "../utils/http";
import { notifyDrawSelected } from "./whatsapp.service";

type DrawInput = {
  drawId: string;
  fixedCount?: number;
  percentage?: number;
};

function shuffle<T>(items: T[]) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = crypto.randomInt(index + 1);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

export async function runLuckyDraw(input: DrawInput) {
  const usePercentage = typeof input.percentage === "number" && input.percentage > 0;
  const requestedFixedCount = input.fixedCount ?? 125;

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const draw = await tx.draw.findUnique({ where: { id: input.drawId } });
    if (!draw) throw new HttpError(404, "Draw not found");

    const paidApplicants = await tx.application.findMany({
      where: { drawId: input.drawId, paymentStatus: PaymentStatus.paid },
      select: { id: true, registrationNo: true, phone: true, entryFee: true }
    });

    if (paidApplicants.length === 0) {
      throw new HttpError(400, "No paid applicants are available for this draw");
    }

    const totalPaidPersons = paidApplicants.length;
    const calculatedCount = usePercentage
      ? Math.ceil(totalPaidPersons * ((input.percentage ?? 1.25) / 100))
      : requestedFixedCount;
    const seatLimit = Math.min(calculatedCount, totalPaidPersons);
    
    // Each person in the application gets a ticket
    const tickets: string[] = paidApplicants.map((app: { id: string }) => app.id);
    const selectedIds = new Set<string>();
    let selectedPersonCount = 0;

    for (const applicationId of shuffle(tickets)) {
      if (selectedIds.has(applicationId)) continue;

      const applicant = paidApplicants.find((item: { id: string }) => item.id === applicationId);
      if (!applicant) continue;
      if (selectedPersonCount > 0 && selectedPersonCount + 1 > seatLimit) continue;

      selectedIds.add(applicationId);
      selectedPersonCount += 1;
      if (selectedPersonCount >= seatLimit) break;
    }

    await tx.application.updateMany({
      where: { drawId: input.drawId, paymentStatus: PaymentStatus.paid },
      data: { status: ApplicationStatus.not_selected }
    });

    if (selectedIds.size > 0) {
      await tx.application.updateMany({
        where: { id: { in: [...selectedIds] } },
        data: { status: ApplicationStatus.selected }
      });
    }

    // Upsert to handle re-running a draw (though usually a draw is run once then closed)
    const result = await tx.drawResult.upsert({
      where: { drawId: input.drawId },
      update: {
        totalUsers: totalPaidPersons,
        selectedCount: selectedPersonCount,
        percentage: usePercentage ? new Prisma.Decimal(input.percentage ?? 1.25).toNumber() : null
      },
      create: {
        drawId: input.drawId,
        totalUsers: totalPaidPersons,
        selectedCount: selectedPersonCount,
        percentage: usePercentage ? new Prisma.Decimal(input.percentage ?? 1.25).toNumber() : null
      }
    });
    
    // Auto close the draw
    await tx.draw.update({
      where: { id: input.drawId },
      data: { status: DrawStatus.closed }
    });

    const selectedApplications = paidApplicants.filter((applicant: { id: string }) => selectedIds.has(applicant.id));
    notifyDrawSelected(selectedApplications);

    return result;
  });
}
