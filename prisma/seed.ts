import bcrypt from "bcryptjs";
import { PrismaClient, Role, DrawStatus, PaymentStatus } from "@prisma/client";
import crypto from "crypto";

const prisma = new PrismaClient();

function generateReceiptNo(): string {
  const d = new Date();
  const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const rand = crypto.randomBytes(2).toString("hex").toUpperCase();
  return `NHR-${date}-${rand}`;
}

async function main() {
  const isProduction = process.env.NODE_ENV === "production";

  // -- Admin user -------------------------------------------------------------
  const email = process.env.ADMIN_EMAIL ?? "admin@nooreharam.in";
  const password = process.env.ADMIN_PASSWORD ?? (isProduction ? "" : "Admin@12345");
  const name = process.env.ADMIN_NAME ?? "Noor-e-Haram Admin";

  if (isProduction && !process.env.ADMIN_PASSWORD) {
    console.error("❌ Refusing to seed in production without an explicit ADMIN_PASSWORD environment variable!");
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const admin = await prisma.user.upsert({
    where: { email },
    update: { name, password: passwordHash, role: Role.admin },
    create: { name, email, password: passwordHash, role: Role.admin }
  });

  console.log(`Admin ready: ${admin.email}`);

  // -- Default settings -------------------------------------------------------
  await prisma.setting.upsert({
    where: { key: "PAYMENT_MODE" },
    update: { value: isProduction ? "live" : "test" },
    create: { key: "PAYMENT_MODE", value: isProduction ? "live" : "test" }
  });

  await prisma.setting.upsert({
    where: { key: "DEFAULT_DRAW_AMOUNT" },
    update: { value: "1499" },
    create: { key: "DEFAULT_DRAW_AMOUNT", value: "1499" }
  });

  // Ensure RegistrationCounter row exists
  await prisma.registrationCounter.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, counter: 100000 }
  });

  // Skip demo data creation in production
  if (isProduction) {
    console.log("Production environment detected — skipping demo user and application creation.");
    return;
  }

  // -- Demo participant (ONE record - idempotent) -----------------------------
  const demoEmail = "demo@nooreharam.in";
  let demoUser = await prisma.user.findUnique({ where: { email: demoEmail } });
  if (!demoUser) {
    const demoHash = await bcrypt.hash("Demo@12345", 12);
    demoUser = await prisma.user.create({
      data: { name: "Demo Participant", email: demoEmail, password: demoHash, role: Role.user }
    });
  }

  // Ensure there is a draw for the demo
  let demoDraw = await prisma.draw.findFirst({ where: { name: "Demo Lucky Draw" } });
  if (!demoDraw) {
    demoDraw = await prisma.draw.create({
      data: { name: "Demo Lucky Draw", status: DrawStatus.active }
    });
  }

  // Check if demo application already exists
  const existingApp = await prisma.application.findFirst({
    where: { userId: demoUser.id, drawId: demoDraw.id }
  });

  if (!existingApp) {
    // Increment counter
    const counter = await prisma.registrationCounter.update({ where: { id: 1 }, data: { counter: { increment: 1 } } });
    const regNo = `NHR-DEMO-${String(counter.counter).padStart(6, "0")}`;

    const demoApp = await prisma.application.create({
      data: {
        userId: demoUser.id,
        drawId: demoDraw.id,
        registrationNo: regNo,
        applicantName: demoUser.name,
        phone: "9999999999",
        stateCode: "MH",
        stateName: "Maharashtra",
        city: "Mumbai",
        address: "Demo Address, Mumbai",
        entryFee: 1499,
        paymentStatus: PaymentStatus.paid,
        paymentId: "pay_demo0000000001",
        orderId: "order_demo000001",
        completedAt: new Date()
      }
    });

    // Generate receipt for demo participant
    const existingReceipt = await prisma.paymentReceipt.findUnique({ where: { applicationId: demoApp.id } });
    if (!existingReceipt) {
      await prisma.paymentReceipt.create({
        data: {
          receiptNo: generateReceiptNo(),
          applicationId: demoApp.id,
          amount: 1499,
          paymentId: "pay_demo0000000001",
          orderId: "order_demo000001"
        }
      });
    }

    console.log(`Demo participant created: ${demoUser.email} | Reg: ${regNo}`);
  } else {
    console.log("Demo participant already exists - skipping.");
  }
}

main()
  .finally(async () => { await prisma.$disconnect(); })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
