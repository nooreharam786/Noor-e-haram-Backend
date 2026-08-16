import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";

/**
 * Generates an atomic, globally sequential registration number.
 * Sequence: NHCF100001, NHCF100002... NHCF100567, NHCF100568
 * Ensures zero duplicates or skipped numbers across draws and concurrent requests.
 * Historical numbers remain untouched.
 */
export async function generateRegistrationNumber(_drawIndex: number = 0): Promise<string> {
  const nextNumber = await prisma.$transaction(async (tx) => {
    // 1. Fetch current registrationCounter row
    let counterRecord = await tx.registrationCounter.findUnique({
      where: { id: 1 },
    });

    // 2. If record doesn't exist or counter needs baseline initialization, find highest numeric reg in DB
    let currentHighWatermark = counterRecord?.counter || 100000;

    if (!counterRecord) {
      // Find the highest existing registration number in the database to prevent collisions with existing records
      const remainingApplications = await tx.application.findMany({
        where: { registrationNo: { startsWith: "NHCF" } },
        select: { registrationNo: true }
      });

      for (const application of remainingApplications) {
        const num = parseInt(application.registrationNo.replace(/^NHCF/i, ""), 10);
        if (!Number.isNaN(num) && num > currentHighWatermark) {
          currentHighWatermark = num;
        }
      }

      counterRecord = await tx.registrationCounter.create({
        data: { id: 1, counter: currentHighWatermark + 1 },
      });
      return counterRecord.counter;
    }

    // 3. Atomically increment counter by 1
    const updated = await tx.registrationCounter.update({
      where: { id: 1 },
      data: { counter: { increment: 1 } },
    });

    return updated.counter;
  });

  return `NHCF${String(nextNumber).padStart(6, "0")}`;
}
