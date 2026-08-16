import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function cleanDatabase() {
  console.log("=========================================");
  console.log("🧹 NOOR-E-HARAM DATABASE CLEANUP SCRIPT");
  console.log("=========================================\n");

  try {
    // 1. Fetch count before cleanup
    const appsCount = await prisma.application.count();
    const receiptsCount = await prisma.paymentReceipt.count();
    const drawResultsCount = await prisma.drawResult.count();
    const drawBackupsCount = await prisma.drawBackup.count();

    // Preserved data counts
    const settingsCount = await prisma.setting.count();
    const galleryCount = await prisma.galleryItem.count();
    const docsCount = await prisma.publicDocument.count();
    const orgSettingsCount = await prisma.orgSettings.count();
    const marqueeCount = await prisma.marqueeMessage.count();
    const announcementsCount = await prisma.announcement.count();

    console.log("📊 CURRENT RECORD COUNTS BEFORE CLEANUP:");
    console.log(` - Applications:         ${appsCount}`);
    console.log(` - Payment Receipts:     ${receiptsCount}`);
    console.log(` - Draw Results:         ${drawResultsCount}`);
    console.log(` - Draw Backups:         ${drawBackupsCount}`);

    console.log("🔒 PRESERVED DATA SUMMARY:");
    console.log(` - Site Settings:        ${settingsCount}`);
    console.log(` - Gallery Items (imgs): ${galleryCount}`);
    console.log(` - Public Documents:     ${docsCount}`);
    console.log(` - Org Settings:         ${orgSettingsCount}`);
    console.log(` - Marquee Messages:     ${marqueeCount}`);
    console.log(` - Announcements:        ${announcementsCount}\n`);

    console.log("🚀 STARTING DATABASE DELETION TRANSACTION...\n");

    const result = await prisma.$transaction(async (tx) => {
      // Deletions
      const deletedReceipts = await tx.paymentReceipt.deleteMany({});
      const deletedApps = await tx.application.deleteMany({});
      const deletedDrawResults = await tx.drawResult.deleteMany({});
      const deletedDrawBackups = await tx.drawBackup.deleteMany({});
      const deletedDraws = await tx.draw.deleteMany({});

      // Reset Registration Counter
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

    console.log("✅ TRANSACTION COMPLETED SUCCESSFULLY!\n");
    console.log("📋 DELETION SUMMARY:");
    console.log(` - Payment Receipts deleted: ${result.deletedReceipts}`);
    console.log(` - Applications deleted:      ${result.deletedApps}`);
    console.log(` - Draw Results deleted:      ${result.deletedDrawResults}`);
    console.log(` - Draw Backups deleted:      ${result.deletedDrawBackups}`);
    console.log(` - Draws deleted:             ${result.deletedDraws}`);
    console.log(` - Registration Counter:      Reset to 100000\n`);

    // Verify map URL, YT URL, and image settings are intact
    const mapsSetting = await prisma.setting.findUnique({ where: { key: "GOOGLE_MAPS_URL" } });
    const ytSetting = await prisma.setting.findUnique({ where: { key: "SOCIAL_YOUTUBE_URL" } });

    console.log("🔍 PRESERVED KEY SETTINGS VERIFICATION:");
    console.log(` - Google Maps URL:   ${mapsSetting ? mapsSetting.value || "(empty string set)" : "(not set)"}`);
    console.log(` - YouTube Link URL:  ${ytSetting ? ytSetting.value || "(empty string set)" : "(not set)"}`);
    console.log(` - Gallery Items:     ${await prisma.galleryItem.count()} items remaining`);
    console.log(` - Public Documents:  ${await prisma.publicDocument.count()} items remaining`);
    console.log(` - User accounts:     ${await prisma.user.count()} account(s) preserved\n`);

    console.log("🎉 DATABASE IS NOW CLEAN & READY FOR LIVE PRODUCTION!");
  } catch (error) {
    console.error("❌ ERROR CLEANING DATABASE:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

cleanDatabase();
