import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function cleanDemoData() {
  console.log("🧹 Starting demo data cleanup...");

  // 1. Delete payment receipts associated with demo application or demo user
  const demoUser = await prisma.user.findUnique({ where: { email: "demo@nooreharam.in" } });
  if (demoUser) {
    const demoApps = await prisma.application.findMany({ where: { userId: demoUser.id } });
    const demoAppIds = demoApps.map((a) => a.id);

    if (demoAppIds.length > 0) {
      await prisma.paymentReceipt.deleteMany({
        where: { applicationId: { in: demoAppIds } }
      });
      console.log(`Deleted receipts for demo applications.`);

      await prisma.application.deleteMany({
        where: { userId: demoUser.id }
      });
      console.log(`Deleted demo applications.`);
    }

    await prisma.user.delete({
      where: { id: demoUser.id }
    });
    console.log(`Deleted demo user (demo@nooreharam.in).`);
  }

  // 2. Delete Demo Lucky Draw (and any related results/backups/applications if leftover)
  const demoDraws = await prisma.draw.findMany({
    where: {
      OR: [
        { name: { contains: "Demo", mode: "insensitive" } },
        { name: { contains: "Test", mode: "insensitive" } }
      ]
    }
  });

  for (const draw of demoDraws) {
    // Delete related results
    await prisma.drawResult.deleteMany({ where: { drawId: draw.id } });
    await prisma.drawBackup.deleteMany({ where: { drawId: draw.id } });
    
    // Find applications under this draw
    const drawApps = await prisma.application.findMany({ where: { drawId: draw.id } });
    const drawAppIds = drawApps.map((a) => a.id);
    if (drawAppIds.length > 0) {
      await prisma.paymentReceipt.deleteMany({ where: { applicationId: { in: drawAppIds } } });
      await prisma.application.deleteMany({ where: { drawId: draw.id } });
    }

    await prisma.draw.delete({ where: { id: draw.id } });
    console.log(`Deleted draw: ${draw.name} (${draw.id})`);
  }

  // 3. Reset Registration Counter to 0
  await prisma.registrationCounter.upsert({
    where: { id: 1 },
    update: { counter: 0 },
    create: { id: 1, counter: 0 }
  });
  console.log("Reset Registration Counter to 0.");

  console.log("✨ Demo cleanup completed successfully!");
}

cleanDemoData()
  .finally(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error("❌ Cleanup failed:", e);
    await prisma.$disconnect();
    process.exit(1);
  });
