import { DrawStatus, Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import { HttpError } from "../utils/http";

export async function createDraw(data: { name: string; startDate?: Date; endDate?: Date; maxParticipants?: number; maxApplicationsPerUser?: number; makeActive?: boolean }) {
  const highestDraw = await prisma.draw.findFirst({
    orderBy: { drawIndex: "desc" },
    select: { drawIndex: true }
  });

  const nextIndex = highestDraw ? highestDraw.drawIndex + 1 : 0;

  if (data.makeActive) {
    await prisma.draw.updateMany({
      where: { status: DrawStatus.active },
      data: { status: DrawStatus.closed, appControlStatus: "closed" }
    });
  }

  return prisma.draw.create({
    data: {
      name: data.name,
      drawIndex: nextIndex,
      startDate: data.startDate || new Date(),
      endDate: data.endDate,
      maxParticipants: data.maxParticipants,
      maxApplicationsPerUser: data.maxApplicationsPerUser ?? 1,
      status: data.makeActive ? DrawStatus.active : DrawStatus.draft,
      appControlStatus: "open",
    },
  });
}

export async function getActiveDraw() {
  return prisma.draw.findFirst({
    where: { status: DrawStatus.active },
  });
}

export async function activateDraw(id: string) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // Transition current active draw to closed
    await tx.draw.updateMany({
      where: { status: DrawStatus.active, id: { not: id } },
      data: { status: DrawStatus.closed, appControlStatus: "closed" },
    });

    const draw = await tx.draw.findUnique({ where: { id } });
    if (!draw) {
      throw new HttpError(404, "Draw not found");
    }

    return tx.draw.update({
      where: { id },
      data: { status: DrawStatus.active, appControlStatus: "open" },
    });
  });
}

export async function changeDrawStatus(id: string, status: DrawStatus) {
  if (status === DrawStatus.active) {
    return activateDraw(id);
  }

  const draw = await prisma.draw.findUnique({ where: { id } });
  if (!draw) {
    throw new HttpError(404, "Draw not found");
  }

  return prisma.draw.update({
    where: { id },
    data: {
      status,
      ...(status === DrawStatus.closed || status === DrawStatus.archived ? { appControlStatus: "closed" } : {})
    },
  });
}
