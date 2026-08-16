import { PrismaClient } from "@prisma/client";

async function main() {
  console.log("Testing with pooler URL port 6543...");
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: process.env.DATABASE_URL || ""
      }
    }
  });

  try {
    const res = await Promise.all([
      prisma.user.count(),
      prisma.application.count(),
      prisma.application.count({ where: { paymentStatus: "paid" } }),
      prisma.donation.aggregate({ _sum: { amount: true }, _count: true }),
      prisma.draw.count({ where: { status: "active" } }),
      prisma.feedback.count({ where: { isPublished: false } }),
      prisma.contactMessage.count({ where: { status: "unread" } }),
      prisma.auditLog.findMany({ take: 10, orderBy: { createdAt: "desc" } })
    ]);

    console.log("SUCCESS! Stats result:", res);
  } catch (err) {
    console.error("ERROR:", err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
