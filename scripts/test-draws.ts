import "dotenv/config";
import { prisma } from "../src/config/prisma";

async function main() {
  console.log("Testing listDraws and getDrawHistory queries...");

  try {
    console.log("1. Testing listDraws query...");
    const draws = await prisma.draw.findMany({
      orderBy: { createdAt: "desc" },
      include: { result: true, _count: { select: { applications: true } } }
    });
    console.log("✅ listDraws count:", draws.length);
  } catch (err) {
    console.error("❌ ERROR IN listDraws:", err);
  }

  try {
    console.log("2. Testing getDrawHistory query...");
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
    console.log("✅ getDrawHistory count:", completedDraws.length);
  } catch (err) {
    console.error("❌ ERROR IN getDrawHistory:", err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
