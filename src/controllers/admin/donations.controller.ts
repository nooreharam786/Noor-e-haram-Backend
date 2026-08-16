import { z } from "zod";
import { DonationStatus } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { asyncHandler } from "../../utils/http";

export const listDonationsSchema = z.object({
  query: z.object({
    page:       z.coerce.number().int().positive().default(1),
    limit:      z.coerce.number().int().positive().max(100).default(20),
    search:     z.string().trim().max(120).optional(),
    status:     z.nativeEnum(DonationStatus).optional(),
    dateFilter: z.enum(["today", "week", "month"]).optional()
  })
});

function buildDateFilter(dateFilter?: string) {
  const now = new Date();
  if (dateFilter === "today") {
    const s = new Date(now); s.setHours(0, 0, 0, 0);
    const e = new Date(now); e.setHours(23, 59, 59, 999);
    return { gte: s, lte: e };
  }
  if (dateFilter === "week") {
    const s = new Date(now); s.setDate(now.getDate() - 7); s.setHours(0, 0, 0, 0);
    return { gte: s };
  }
  if (dateFilter === "month") {
    const s = new Date(now); s.setDate(1); s.setHours(0, 0, 0, 0);
    return { gte: s };
  }
  return undefined;
}

export const listAdminDonations = asyncHandler(async (req, res) => {
  const { page, limit, search, status, dateFilter } = req.query as any;
  const dateRange = buildDateFilter(dateFilter);

  const where: any = {
    ...(status ? { status } : {}),
    ...(dateRange ? { createdAt: dateRange } : {}),
    ...(search ? {
      OR: [
        { donorName: { contains: search, mode: "insensitive" } },
        { email:     { contains: search, mode: "insensitive" } },
        { phone:     { contains: search, mode: "insensitive" } },
        { receiptId: { contains: search, mode: "insensitive" } },
        { paymentId: { contains: search, mode: "insensitive" } }
      ]
    } : {})
  };

  const [items, total] = await Promise.all([
    prisma.donation.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take:  limit
    }),
    prisma.donation.count({ where })
  ]);

  res.json({
    success: true,
    data: { items, meta: { page, limit, total, pages: Math.ceil(total / limit) } }
  });
});

export const exportDonationsCsv = asyncHandler(async (req, res) => {
  const { status, dateFilter, search } = req.query as any;
  const dateRange = buildDateFilter(dateFilter);

  const where: any = {
    ...(status ? { status } : {}),
    ...(dateRange ? { createdAt: dateRange } : {}),
    ...(search ? {
      OR: [
        { donorName: { contains: search, mode: "insensitive" } },
        { receiptId: { contains: search, mode: "insensitive" } }
      ]
    } : {})
  };

  const items = await prisma.donation.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 10000
  });

  const header = ["Date","Donor Name","Phone","Email","Amount","Currency","Donation Type","On Behalf Of","Payment ID","Receipt ID","Status"];
  const rows = items.map((d) => [
    new Date(d.createdAt).toISOString().split("T")[0],
    d.donorName,
    d.phone,
    d.email ?? "",
    d.amount,
    d.currency,
    d.donationType,
    d.onBehalfOf ?? "",
    d.paymentId ?? "",
    d.receiptId ?? "",
    d.status
  ]);

  const csv = [header, ...rows].map((row) =>
    row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")
  ).join("\n");

  res.set({
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="donations-${Date.now()}.csv"`
  });
  res.send("\uFEFF" + csv);
});
