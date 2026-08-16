import "dotenv/config";
import { prisma } from "../src/config/prisma";

async function main() {
  console.log("Testing stats query with src/config/prisma...");
  try {
    const stats = await Promise.all([
      prisma.user.count(),
      prisma.application.count(),
      prisma.application.count({ where: { paymentStatus: "paid" } }),
      prisma.donation.aggregate({ _sum: { amount: true }, _count: true }),
      prisma.draw.count({ where: { status: "active" } }),
      prisma.feedback.count({ where: { isPublished: false } }),
      prisma.contactMessage.count({ where: { status: "unread" } }),
      prisma.auditLog.findMany({ take: 10, orderBy: { createdAt: "desc" } })
    ]);

    console.log("✅ CMS STATS QUERY SUCCESSFUL!");
    console.log("Returned data:", {
      totalUsers: stats[0],
      totalApplicants: stats[1],
      paidApplicants: stats[2],
      totalDonations: stats[3],
      activeDraws: stats[4],
      pendingFeedback: stats[5],
      unreadMessages: stats[6],
      auditLogsCount: stats[7].length
    });
  } catch (err) {
    console.error("❌ ERROR:", err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
