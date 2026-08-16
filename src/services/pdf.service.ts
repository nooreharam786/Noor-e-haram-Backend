import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import path from "path";
import fs from "fs";
import { Application, User, Draw, PaymentReceipt } from "@prisma/client";
import { getOrgSettings } from "./orgSettings.service";


type ApplicationWithRelations = Application & {
  user: Pick<User, "name" | "email">;
  draw: Pick<Draw, "name">;
};

type ReceiptWithApplication = PaymentReceipt & {
  application?: (Application & {
    user: Pick<User, "name" | "email">;
    draw: Pick<Draw, "name">;
  }) | null;
  donorName?: string;
  email?: string;
  phone?: string;
  donationType?: string;
  onBehalfOf?: string;
  isAnonymous?: boolean;
};

function formatDate(dateInput: Date | string | number | undefined | null): string {
  if (!dateInput) return new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const date = new Date(dateInput);
  if (isNaN(date.getTime())) return String(dateInput);
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function formatTime(dateInput: Date | string | number | undefined | null): string {
  if (!dateInput) return new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: true });
  const date = new Date(dateInput);
  if (isNaN(date.getTime())) return String(dateInput);
  return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: true });
}

function formatDateTime(dateInput: Date | string | number | undefined | null): string {
  return `${formatDate(dateInput)}, ${formatTime(dateInput)}`;
}

/**
 * Helper to draw text perfectly centered horizontally & vertically inside a box.
 * Solves PDFKit vertical text alignment issues inside colored background boxes.
 */
function drawCenteredTextInBox(
  doc: PDFKit.PDFDocument,
  text: string,
  boxX: number,
  boxY: number,
  boxW: number,
  boxH: number,
  fontSize: number,
  textColor: string,
  bgColor?: string,
  borderRadius: number = 4,
  font: string = "Helvetica-Bold"
) {
  doc.save();
  if (bgColor) {
    if (borderRadius > 0) {
      doc.roundedRect(boxX, boxY, boxW, boxH, borderRadius).fill(bgColor);
    } else {
      doc.rect(boxX, boxY, boxW, boxH).fill(bgColor);
    }
  }

  doc.font(font).fontSize(fontSize);
  const textY = boxY + (boxH - fontSize) / 2 - 3.5;

  doc.fillColor(textColor)
    .font(font)
    .fontSize(fontSize)
    .text(text, boxX, textY, {
      width: boxW,
      align: "center",
      lineBreak: false,
    });
  doc.restore();
}

/**
 * Helper to draw text inside header bars / boxes with explicit vertical centering.
 */
function drawTextInBox(
  doc: PDFKit.PDFDocument,
  text: string,
  boxX: number,
  boxY: number,
  boxW: number,
  boxH: number,
  fontSize: number,
  textColor: string,
  align: "left" | "center" | "right" = "left",
  paddingLeft: number = 8,
  font: string = "Helvetica-Bold"
) {
  doc.save();
  doc.font(font).fontSize(fontSize);
  const textY = boxY + (boxH - fontSize) / 2 - 3.5;

  const startX = align === "left" ? boxX + paddingLeft : boxX;
  const targetW = align === "left" ? boxW - paddingLeft * 2 : boxW;

  doc.fillColor(textColor)
    .font(font)
    .fontSize(fontSize)
    .text(text, startX, textY, {
      width: targetW,
      align,
      lineBreak: false,
    });
  doc.restore();
}

function drawCheckmark(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  size: number = 10,
  strokeColor: string = "#FFFFFF",
  lineWidth: number = 1.5
) {
  doc.save();
  doc.strokeColor(strokeColor).lineWidth(lineWidth).lineCap("round").lineJoin("round");
  doc.moveTo(x, y + size * 0.5)
    .lineTo(x + size * 0.35, y + size * 0.85)
    .lineTo(x + size, y + size * 0.2)
    .stroke();
  doc.restore();
}

function drawCheckCircle(
  doc: PDFKit.PDFDocument,
  cx: number,
  cy: number,
  radius: number = 6,
  bgColor: string = "#0C3B25",
  checkColor: string = "#FFFFFF"
) {
  doc.save();
  doc.circle(cx, cy, radius).fill(bgColor);
  drawCheckmark(doc, cx - radius * 0.45, cy - radius * 0.5, radius * 0.9, checkColor, 1.2);
  doc.restore();
}

function drawUserIcon(doc: PDFKit.PDFDocument, x: number, y: number, color: string = "#FFFFFF") {
  doc.save();
  doc.fillColor(color);
  doc.circle(x + 5, y + 3, 2.8).fill(color);
  doc.ellipse(x + 5, y + 10, 4.5, 3).fill(color);
  doc.restore();
}

function drawEmailIcon(doc: PDFKit.PDFDocument, x: number, y: number, color: string = "#FFFFFF") {
  doc.save();
  doc.strokeColor(color).lineWidth(1);
  doc.rect(x, y + 1, 10, 7).stroke(color);
  doc.moveTo(x, y + 1).lineTo(x + 5, y + 5).lineTo(x + 10, y + 1).stroke(color);
  doc.restore();
}

function drawPhoneIcon(doc: PDFKit.PDFDocument, x: number, y: number, color: string = "#FFFFFF") {
  doc.save();
  doc.strokeColor(color).lineWidth(1).lineCap("round");
  doc.roundedRect(x + 2, y + 1, 6, 9, 1).stroke(color);
  doc.circle(x + 5, y + 8, 0.6).fill(color);
  doc.restore();
}

function drawListIcon(doc: PDFKit.PDFDocument, x: number, y: number, color: string = "#FFFFFF") {
  doc.save();
  doc.strokeColor(color).lineWidth(1);
  doc.rect(x + 1, y, 8, 10).stroke(color);
  doc.moveTo(x + 3, y + 3).lineTo(x + 7, y + 3).stroke(color);
  doc.moveTo(x + 3, y + 5.5).lineTo(x + 7, y + 5.5).stroke(color);
  doc.moveTo(x + 3, y + 8).lineTo(x + 6, y + 8).stroke(color);
  doc.restore();
}

function drawInfoIcon(doc: PDFKit.PDFDocument, cx: number, cy: number, radius: number = 7, bgColor: string = "#C5A059") {
  doc.save();
  doc.circle(cx, cy, radius).fill(bgColor);
  doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(8);
  doc.text("i", cx - 2, cy - 4.5, { width: 4, align: "center" });
  doc.restore();
}

function drawCalendarIcon(doc: PDFKit.PDFDocument, x: number, y: number, color: string = "#C5A059") {
  doc.save();
  doc.strokeColor(color).lineWidth(1);
  doc.roundedRect(x, y + 2, 9, 8, 1).stroke(color);
  doc.moveTo(x, y + 4.5).lineTo(x + 9, y + 4.5).stroke(color);
  doc.moveTo(x + 2.5, y).lineTo(x + 2.5, y + 2.5).stroke(color);
  doc.moveTo(x + 6.5, y).lineTo(x + 6.5, y + 2.5).stroke(color);
  doc.restore();
}

function drawStampSeal(doc: PDFKit.PDFDocument, cx: number, cy: number, radius: number = 26) {
  doc.save();
  const goldColor = "#C5A059";
  doc.circle(cx, cy, radius).lineWidth(1.2).strokeColor(goldColor).stroke();
  doc.circle(cx, cy, radius - 3).lineWidth(0.5).strokeColor(goldColor).stroke();
  doc.circle(cx, cy, radius - 5).lineWidth(0.5).strokeColor(goldColor).stroke();

  doc.fillColor(goldColor).font("Helvetica-Bold").fontSize(5.5);
  doc.text("NOOR E HARAM", cx - radius + 4, cy - 9, { width: (radius - 4) * 2, align: "center" });
  doc.fontSize(4.5).font("Helvetica");
  doc.text("★ TRUST ★", cx - radius + 4, cy - 2, { width: (radius - 4) * 2, align: "center" });
  doc.fontSize(4.5).font("Helvetica-Bold");
  doc.text("CHARITY", cx - radius + 4, cy + 5, { width: (radius - 4) * 2, align: "center" });
  doc.restore();
}

function drawCornerFlourishes(doc: PDFKit.PDFDocument, marginX: number, marginY: number, width: number, height: number) {
  doc.save();
  const goldColor = "#C5A059";
  doc.strokeColor(goldColor).lineWidth(0.75);

  const len = 14;
  const offset = 4;

  // Top-Left
  doc.moveTo(marginX + offset, marginY + offset + len).lineTo(marginX + offset, marginY + offset).lineTo(marginX + offset + len, marginY + offset).stroke();
  doc.circle(marginX + offset + 2, marginY + offset + 2, 1.2).fill(goldColor);

  // Top-Right
  const rightX = marginX + width - offset;
  doc.moveTo(rightX - len, marginY + offset).lineTo(rightX, marginY + offset).lineTo(rightX, marginY + offset + len).stroke();
  doc.circle(rightX - 2, marginY + offset + 2, 1.2).fill(goldColor);

  // Bottom-Left
  const bottomY = marginY + height - offset;
  doc.moveTo(marginX + offset, bottomY - len).lineTo(marginX + offset, bottomY).lineTo(marginX + offset + len, bottomY).stroke();
  doc.circle(marginX + offset + 2, bottomY - 2, 1.2).fill(goldColor);

  // Bottom-Right
  doc.moveTo(rightX - len, bottomY).lineTo(rightX, bottomY).lineTo(rightX, bottomY - len).stroke();
  doc.circle(rightX - 2, bottomY - 2, 1.2).fill(goldColor);

  doc.restore();
}

export async function generateTicketPdf(application: ApplicationWithRelations): Promise<Buffer> {
  const orgSettings = await getOrgSettings();
  return new Promise(async (resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 0, size: "A4" });
      const chunks: Buffer[] = [];

      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const frontendUrl = process.env.FRONTEND_URL || "https://nooreharam.in";
      const validationUrl = `${frontendUrl}/verify/${application.registrationNo}`;
      const qrDataUrl = await QRCode.toDataURL(validationUrl, {
        margin: 1,
        color: { dark: "#0B4633", light: "#FFFFFF" },
      });

      // Colors
      const BRAND_DARK = "#0B4633";
      const BRAND_GOLD = "#D8A820";
      const BORDER_LIGHT = "#E5E0D8";
      const TEXT_MAIN = "#1A1A14";
      const TEXT_MUTED = "#5A5A4A";

      const pageW = 595.28;
      const pageH = 841.89;
      const contentX = 35;
      const contentW = 525;

      // 1. Frames & Corner Flourishes
      doc.save();
      doc.rect(20, 20, pageW - 40, pageH - 40).lineWidth(1.5).strokeColor(BRAND_DARK).stroke();
      doc.rect(24, 24, pageW - 48, pageH - 48).lineWidth(0.5).strokeColor(BRAND_GOLD).stroke();
      drawCornerFlourishes(doc, 24, 24, pageW - 48, pageH - 48);
      doc.restore();

      // 2. Header Section
      doc.save();
      if (orgSettings.logo_url && orgSettings.logo_url.startsWith("data:image")) {
        try {
          doc.image(orgSettings.logo_url, (pageW - 50) / 2, 28, { width: 50 });
        } catch {}
      }
      doc.fillColor(BRAND_DARK).font("Helvetica-Bold").fontSize(18);
      doc.text("NOOR E HARAM", 0, 36, { width: pageW, align: "center" });

      doc.fillColor(BRAND_GOLD).font("Helvetica-Bold").fontSize(9);
      doc.text("CHARITY FOUNDATION", 0, 58, { width: pageW, align: "center" });

      doc.fillColor(TEXT_MUTED).font("Helvetica").fontSize(7.5);
      doc.text("Faith  •  Service  •  Humanity", 0, 70, { width: pageW, align: "center" });

      doc.fillColor(BRAND_DARK).font("Helvetica-Bold").fontSize(12);
      doc.text("OFFICIAL LUCKY DRAW REGISTRATION TICKET", 0, 84, { width: pageW, align: "center" });

      doc.moveTo(contentX, 102).lineTo(contentX + contentW, 102).lineWidth(0.5).strokeColor(BORDER_LIGHT).stroke();
      doc.restore();

      // 3. Status Bar (Y: 108 - 156)
      const isPaid = application.paymentStatus === "paid";
      const statusText = isPaid ? "PAID" : "PENDING";
      const statusColor = isPaid ? BRAND_DARK : "#B8860B";
      const issueDateStr = formatDate(application.createdAt);

      doc.fillColor(TEXT_MUTED).font("Helvetica-Bold").fontSize(7).text("REGISTRATION NUMBER", contentX, 110);
      drawCenteredTextInBox(doc, application.registrationNo, contentX, 120, 135, 24, 9.5, "#FFFFFF", BRAND_DARK, 4, "Helvetica-Bold");

      doc.fillColor(TEXT_MUTED).font("Helvetica-Bold").fontSize(7).text("STATUS", 185, 110);
      drawCenteredTextInBox(doc, statusText, 185, 120, 75, 24, 9, "#FFFFFF", statusColor, 4, "Helvetica-Bold");

      doc.fillColor(TEXT_MUTED).font("Helvetica-Bold").fontSize(7).text("ISSUE DATE", 275, 110);
      doc.fillColor(TEXT_MAIN).font("Helvetica-Bold").fontSize(9).text(issueDateStr, 275, 122);

      // QR Scan box right side
      const verifyBoxX = 365;
      const verifyBoxY = 108;
      const verifyBoxW = 195;
      const verifyBoxH = 46;
      doc.roundedRect(verifyBoxX, verifyBoxY, verifyBoxW, verifyBoxH, 4).fillAndStroke("#FFFFFF", BORDER_LIGHT);
      doc.image(qrDataUrl, verifyBoxX + 5, verifyBoxY + 5, { width: 36, height: 36 });
      doc.fillColor(TEXT_MAIN).font("Helvetica-Bold").fontSize(7.5).text("SCAN TO VERIFY", verifyBoxX + 46, verifyBoxY + 7);
      doc.fillColor(TEXT_MUTED).font("Helvetica").fontSize(6.2).text(
        "Scan QR code to verify ticket authenticity online.",
        verifyBoxX + 46,
        verifyBoxY + 18,
        { width: 142, lineGap: 1 }
      );

      doc.moveTo(contentX, 162).lineTo(contentX + contentW, 162).lineWidth(0.5).strokeColor(BORDER_LIGHT).stroke();

      // 4. Main Two Columns (Y: 170 to 440)
      const colW = 255;
      const colH = 260;
      const leftColX = contentX;
      const rightColX = contentX + colW + 15;
      const middleY = 170;

      // Left: Applicant Information
      doc.save();
      doc.roundedRect(leftColX, middleY, colW, colH, 5).fillAndStroke("#FFFFFF", BORDER_LIGHT);
      doc.roundedRect(leftColX, middleY, colW, 24, 5).fill(BRAND_DARK);
      doc.rect(leftColX, middleY + 12, colW, 12).fill(BRAND_DARK);
      drawTextInBox(doc, "APPLICANT INFORMATION", leftColX + 10, middleY, colW - 20, 24, 8.5, "#FFFFFF", "left", 0, "Helvetica-Bold");

      const applicantRows: [string, string][] = [
        ["Full Name", application.applicantName || application.user.name],
        ["Email Address", application.user.email],
        ["Phone Number", application.phone],
        ["Address", application.address || "—"],
        ["City / State", `${application.city}, ${application.stateName}`],
        ["Country", (application as any).countryName || "India"],
      ];

      const rowH_left = (colH - 24) / applicantRows.length;
      applicantRows.forEach(([label, val], idx) => {
        const ry = middleY + 24 + idx * rowH_left;
        if (idx % 2 === 0) doc.rect(leftColX + 1, ry, colW - 2, rowH_left).fill("#F9FAFB");
        doc.fillColor(TEXT_MUTED).font("Helvetica-Bold").fontSize(7.5).text(label, leftColX + 10, ry + 6);
        doc.fillColor(TEXT_MAIN).font("Helvetica-Bold").fontSize(8.5).text(val, leftColX + 100, ry + 6, { width: colW - 110 });
        if (idx < applicantRows.length - 1) {
          doc.moveTo(leftColX + 10, ry + rowH_left).lineTo(leftColX + colW - 10, ry + rowH_left).lineWidth(0.5).strokeColor("#F3F4F6").stroke();
        }
      });
      doc.restore();

      // Right: Registration Details
      doc.save();
      doc.roundedRect(rightColX, middleY, colW, colH, 5).fillAndStroke("#FFFFFF", BORDER_LIGHT);
      doc.roundedRect(rightColX, middleY, colW, 24, 5).fill(BRAND_DARK);
      doc.rect(rightColX, middleY + 12, colW, 12).fill(BRAND_DARK);
      drawTextInBox(doc, "REGISTRATION DETAILS", rightColX + 10, middleY, colW - 20, 24, 8.5, "#FFFFFF", "left", 0, "Helvetica-Bold");

      const regRows: [string, string][] = [
        ["Draw Name", application.draw.name],
        ["Application Date", formatDate(application.createdAt)],
        ["Entry Fee", `Rs. ${application.entryFee.toLocaleString("en-IN")}`],
        ["Payment Status", application.paymentStatus.toUpperCase()],
        ["Application Status", application.status.toUpperCase()],
        ["Transaction ID", application.paymentId || "—"],
      ];

      const rowH_right = (colH - 24) / regRows.length;
      regRows.forEach(([label, val], idx) => {
        const ry = middleY + 24 + idx * rowH_right;
        if (idx % 2 === 0) doc.rect(rightColX + 1, ry, colW - 2, rowH_right).fill("#F9FAFB");
        doc.fillColor(TEXT_MUTED).font("Helvetica-Bold").fontSize(7.5).text(label, rightColX + 10, ry + 6);
        doc.fillColor(TEXT_MAIN).font("Helvetica-Bold").fontSize(8.5).text(val, rightColX + 100, ry + 6, { width: colW - 110 });
        if (idx < regRows.length - 1) {
          doc.moveTo(rightColX + 10, ry + rowH_right).lineTo(rightColX + colW - 10, ry + rowH_right).lineWidth(0.5).strokeColor("#F3F4F6").stroke();
        }
      });
      doc.restore();

      // 5. Verification Box & Important Info (Y: 450 to 590)
      const lowerY = 450;
      const lowerH = 140;
      const qrColW = 170;
      const infoColX = contentX + qrColW + 15;
      const infoColW = contentW - qrColW - 15;

      doc.save();
      doc.roundedRect(contentX, lowerY, qrColW, lowerH, 5).fillAndStroke("#FFFFFF", BORDER_LIGHT);
      doc.roundedRect(contentX, lowerY, qrColW, 22, 5).fill(BRAND_DARK);
      doc.rect(contentX, lowerY + 11, qrColW, 11).fill(BRAND_DARK);
      drawCenteredTextInBox(doc, "VERIFICATION QR CODE", contentX, lowerY, qrColW, 22, 8, "#FFFFFF", undefined, 0, "Helvetica-Bold");

      doc.image(qrDataUrl, contentX + (qrColW - 60) / 2, lowerY + 28, { width: 60, height: 60 });
      doc.fillColor(TEXT_MUTED).font("Helvetica").fontSize(6).text(
        "Unique QR code linked to this lucky draw ticket registration.",
        contentX + 6, lowerY + 92, { width: qrColW - 12, align: "center" }
      );
      drawCenteredTextInBox(doc, application.registrationNo, contentX + 15, lowerY + 114, qrColW - 30, 16, 7.5, TEXT_MAIN, "#F3F4F6", 3, "Helvetica-Bold");
      doc.restore();

      // Important Info
      doc.save();
      doc.roundedRect(infoColX, lowerY, infoColW, lowerH, 5).fillAndStroke("#FAF4EC", "#E5DFD0");
      drawInfoIcon(doc, infoColX + 14, lowerY + 14, 6, BRAND_GOLD);
      doc.fillColor(TEXT_MAIN).font("Helvetica-Bold").fontSize(8.5).text("IMPORTANT INFORMATION", infoColX + 24, lowerY + 10);

      const bullets = [
        "This is an official registration ticket issued by Noor E Haram Charity Foundation.",
        "Keep this document safely for your records and verification.",
        "Carry this document for verification if requested by the foundation.",
        "Selection does not guarantee travel until final verification and approval."
      ];
      bullets.forEach((bText, i) => {
        const by = lowerY + 28 + i * 24;
        drawCheckCircle(doc, infoColX + 14, by + 4, 4, BRAND_DARK, "#FFFFFF");
        doc.fillColor("#374151").font("Helvetica").fontSize(7.2).text(bText, infoColX + 24, by + 1, { width: infoColW - 32 });
      });
      doc.restore();

      // 6. Seals & Signatures (Y: 600 to 680)
      const sigY = 605;
      if (orgSettings.seal_image_url && orgSettings.seal_image_url.startsWith("data:image")) {
        try {
          doc.image(orgSettings.seal_image_url, contentX + 15, sigY + 5, { width: 50, height: 50 });
        } catch {
          drawStampSeal(doc, contentX + 40, sigY + 30, 24);
        }
      } else {
        drawStampSeal(doc, contentX + 40, sigY + 30, 24);
      }

      doc.save();
      doc.fillColor("#6B7280").font("Helvetica-Bold").fontSize(7).text("AUTHORIZED DIGITAL SIGNATURE", contentX + 150, sigY + 4, { width: 180, align: "center" });

      let sigDrawn = false;
      if (orgSettings.signature_image_url && orgSettings.signature_image_url.startsWith("data:image")) {
        try {
          doc.image(orgSettings.signature_image_url, contentX + 190, sigY + 14, { width: 100, height: 24 });
          sigDrawn = true;
        } catch {}
      }
      if (!sigDrawn) {
        try {
          const sigPath = path.join(__dirname, "../../public/signature.png");
          if (fs.existsSync(sigPath)) {
            doc.image(sigPath, contentX + 190, sigY + 14, { width: 100, height: 24 });
          }
        } catch {}
      }
      doc.moveTo(contentX + 165, sigY + 40).lineTo(contentX + 315, sigY + 40).lineWidth(0.75).strokeColor("#6B7280").stroke();
      doc.fillColor(TEXT_MAIN).font("Helvetica-Bold").fontSize(8).text(orgSettings.signatory_name || "Afzal Shaikh", contentX + 150, sigY + 44, { width: 180, align: "center" });
      doc.restore();

      // Digital doc box
      doc.save();
      const digW = 155;
      const digX = contentX + contentW - digW;
      doc.roundedRect(digX, sigY + 4, digW, 50, 5).fillAndStroke("#FFFFFF", BORDER_LIGHT);
      drawCheckCircle(doc, digX + 14, sigY + 18, 4.5, BRAND_DARK, "#FFFFFF");
      doc.fillColor(BRAND_DARK).font("Helvetica-Bold").fontSize(7.5).text("DIGITAL DOCUMENT", digX + 24, sigY + 14);
      doc.fillColor(TEXT_MUTED).font("Helvetica").fontSize(6.2).text(
        "Computer generated and verified by Noor E Haram Charity Foundation.",
        digX + 10, sigY + 26, { width: digW - 20 }
      );
      doc.restore();

      // 7. Footer Banner (Y: 690 - 750)
      const footerY = 695;
      const footerH = 40;
      doc.save();
      doc.roundedRect(contentX, footerY, contentW, footerH, 4).fill(BRAND_DARK);

      const fCols = [
        { label: "Phone", val: orgSettings.phone || "+91 9213408880", x: contentX + 15, w: 105 },
        { label: "Email", val: orgSettings.email || "support@nooreharam.in", x: contentX + 125, w: 125 },
        { label: "Website", val: orgSettings.website || "www.nooreharam.in", x: contentX + 255, w: 110 },
        { label: "Address", val: orgSettings.address || "Shop No. 12, Mumbra, Thane - 400612", x: contentX + 370, w: 145 },
      ];
      fCols.forEach((col) => {
        doc.fillColor("#9CA3AF").font("Helvetica").fontSize(6).text(col.label, col.x, footerY + 6);
        doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(7).text(col.val, col.x, footerY + 16, { width: col.w });
      });
      doc.restore();

      doc.save();
      const sysDateStr = formatDateTime(new Date());
      doc.fillColor(TEXT_MUTED).font("Helvetica").fontSize(6.5).text(`Document Generated On: ${sysDateStr} | System Version: v1.0`, contentX, footerY + 46);
      doc.fillColor(TEXT_MUTED).font("Helvetica").fontSize(6.5).text(`© ${new Date().getFullYear()} Noor E Haram Charity Foundation. All Rights Reserved.`, contentX, footerY + 46, {
        width: contentW,
        align: "right",
      });
      doc.restore();

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}


export async function generateReceiptPdf(receipt: ReceiptWithApplication): Promise<Buffer> {
  const orgSettings = await getOrgSettings();
  return new Promise(async (resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 0, size: "A4" });
      const chunks: Buffer[] = [];

      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const application = receipt.application;
      const isApplicationPayment = Boolean(application);

      // Extract values with safe fallbacks
      const regNo = application?.registrationNo || receipt.receiptNo || "NHR-PAY-DEMO-001";
      const receiptNo = receipt.receiptNo || "NHR-PAY-DEMO-001";
      const personName = application?.applicantName || application?.user?.name || receipt.donorName || "Applicant";
      const email = application?.user?.email || receipt.email || "—";
      const phone = application?.phone || receipt.phone || "—";
      const campaignName = application?.draw?.name || receipt.onBehalfOf || "Umrah Lucky Draw";
      const amountStr = `Rs. ${(receipt.amount || 5000).toLocaleString("en-IN")}`;
      const paymentId = receipt.paymentId || "pay_demo999999";
      const orderId = receipt.orderId || "order_demo999999";
      const completedDate = application?.completedAt || receipt.generatedAt || new Date();

      const issueDateStr = formatDate(completedDate);
      const issueTimeStr = formatTime(completedDate);
      const fullDateTimeStr = `${issueDateStr}, ${issueTimeStr}`;

      // Generate QR Code Buffer
      const validationUrl = `${process.env.FRONTEND_URL || "https://nooreharam.in"}/validate/${regNo}`;
      const qrDataUrl = await QRCode.toDataURL(validationUrl, {
        margin: 1,
        color: { dark: "#0C3B25", light: "#FFFFFF" },
      });

      // Colors
      const BRAND_DARK = "#0C3B25";
      const BRAND_GOLD = "#C5A059";
      const BRAND_GREEN_PILL = "#1E6B45";
      const BORDER_LIGHT = "#E5E7EB";
      const BG_CREAM = "#F8F6F0";
      const TEXT_MAIN = "#1F2937";
      const TEXT_MUTED = "#6B7280";

      // Page dimensions
      const pageW = 595.28;
      const pageH = 841.89;
      const contentX = 35;
      const contentW = 525;

      // 1. Page Frames & Corner Flourishes
      doc.save();
      doc.rect(20, 20, pageW - 40, pageH - 40).lineWidth(1.5).strokeColor(BRAND_DARK).stroke();
      doc.rect(24, 24, pageW - 48, pageH - 48).lineWidth(0.5).strokeColor(BRAND_DARK).stroke();
      drawCornerFlourishes(doc, 24, 24, pageW - 48, pageH - 48);
      doc.restore();

      // 2. Header Section
      doc.save();
      if (orgSettings.logo_url && orgSettings.logo_url.startsWith("data:image")) {
        try {
          doc.image(orgSettings.logo_url, (pageW - 50) / 2, 28, { width: 50 });
        } catch {
          // fallback to text
        }
      }
      doc.fillColor(BRAND_DARK).font("Helvetica-Bold").fontSize(20);
      doc.text("NOOR E HARAM", 0, 38, { width: pageW, align: "center" });

      const barW = 65;
      const barX = (pageW - barW) / 2;
      doc.rect(barX, 60, barW, 2).fill(BRAND_GOLD);

      doc.fillColor(BRAND_GOLD).font("Helvetica-Bold").fontSize(9.5);
      doc.text("CHARITY FOUNDATION", 0, 66, { width: pageW, align: "center" });

      doc.fillColor("#4B5563").font("Helvetica").fontSize(8);
      doc.text("Faith  •  Service  •  Humanity", 0, 80, { width: pageW, align: "center" });

      const documentTitle = isApplicationPayment ? "OFFICIAL PAYMENT RECEIPT" : "OFFICIAL DONATION RECEIPT";
      doc.fillColor(BRAND_DARK).font("Helvetica-Bold").fontSize(13.5);
      doc.text(documentTitle, 0, 96, { width: pageW, align: "center" });

      doc.moveTo(contentX, 116).lineTo(contentX + contentW, 116).lineWidth(0.5).strokeColor(BORDER_LIGHT).stroke();
      doc.restore();

      // 3. Top Badges & Scan to Verify Row (Y: 124 - 172)
      doc.fillColor(TEXT_MUTED).font("Helvetica-Bold").fontSize(7).text("REGISTRATION NUMBER", contentX, 124);
      drawCenteredTextInBox(doc, regNo, contentX, 134, 135, 26, 9.5, "#FFFFFF", BRAND_DARK, 4, "Helvetica-Bold");

      doc.fillColor(TEXT_MUTED).font("Helvetica-Bold").fontSize(7).text("STATUS", 180, 124);
      doc.save();
      doc.roundedRect(180, 134, 75, 26, 4).fill(BRAND_DARK);
      drawCheckmark(doc, 190, 141, 10, "#FFFFFF", 1.8);
      drawTextInBox(doc, "PAID", 203, 134, 48, 26, 9.5, "#FFFFFF", "left", 0, "Helvetica-Bold");
      doc.restore();

      drawCalendarIcon(doc, 268, 123, BRAND_GOLD);
      doc.fillColor(TEXT_MUTED).font("Helvetica-Bold").fontSize(7).text("ISSUE DATE", 281, 124);
      doc.fillColor(TEXT_MAIN).font("Helvetica-Bold").fontSize(9.5).text(issueDateStr, 268, 136);
      doc.fillColor(TEXT_MUTED).font("Helvetica").fontSize(8).text(issueTimeStr, 268, 149);

      doc.save();
      const verifyBoxX = 365;
      const verifyBoxY = 122;
      const verifyBoxW = 195;
      const verifyBoxH = 46;
      doc.roundedRect(verifyBoxX, verifyBoxY, verifyBoxW, verifyBoxH, 5).fillAndStroke("#FFFFFF", BORDER_LIGHT);

      doc.image(qrDataUrl, verifyBoxX + 5, verifyBoxY + 5, { width: 36, height: 36 });
      doc.fillColor(TEXT_MAIN).font("Helvetica-Bold").fontSize(7.5).text("SCAN TO VERIFY", verifyBoxX + 46, verifyBoxY + 7);
      doc.fillColor(TEXT_MUTED).font("Helvetica").fontSize(6.2).text(
        "This QR code can be used to verify the authenticity of this registration.",
        verifyBoxX + 46,
        verifyBoxY + 18,
        { width: 142, lineGap: 1 }
      );
      doc.restore();

      doc.moveTo(contentX, 178).lineTo(contentX + contentW, 178).lineWidth(0.5).strokeColor(BORDER_LIGHT).stroke();

      // 4. Middle Two Columns (Y: 186 to 456)
      const colW = 255;
      const colH = 270;
      const leftColX = contentX;
      const rightColX = contentX + colW + 15;
      const middleY = 186;

      // Left Column
      const leftCardTitle = isApplicationPayment ? "APPLICANT INFORMATION" : "DONOR INFORMATION";
      doc.save();
      doc.roundedRect(leftColX, middleY, colW, colH, 6).fillAndStroke("#FFFFFF", BORDER_LIGHT);
      doc.roundedRect(leftColX, middleY, colW, 28, 6).fill(BRAND_DARK);
      doc.rect(leftColX, middleY + 14, colW, 14).fill(BRAND_DARK);
      drawUserIcon(doc, leftColX + 10, middleY + 8, "#FFFFFF");
      drawTextInBox(doc, leftCardTitle, leftColX + 26, middleY, colW - 30, 28, 9, "#FFFFFF", "left", 0, "Helvetica-Bold");

      const donorRows: [string, string, string][] = isApplicationPayment
        ? [
            ["Applicant Name", personName, "user"],
            ["Email Address", email, "email"],
            ["Phone Number", phone, "phone"],
            ["Registration No", regNo, "info"],
            ["Lucky Draw", campaignName, "info"],
          ]
        : [
            ["Donor Name", personName, "user"],
            ["Email Address", email, "email"],
            ["Phone Number", phone, "phone"],
            ["On Behalf Of", campaignName, "info"],
            ["Anonymous", receipt.isAnonymous ? "Yes" : "No", "info"],
          ];

      const rowH_left = (colH - 28) / donorRows.length;
      donorRows.forEach(([label, val, iconType], idx) => {
        const ry = middleY + 28 + idx * rowH_left;
        if (idx % 2 === 0) {
          doc.rect(leftColX + 1, ry, colW - 2, rowH_left).fill("#F9FAFB");
        }
        if (iconType === "user") drawUserIcon(doc, leftColX + 10, ry + 8, BRAND_DARK);
        else if (iconType === "email") drawEmailIcon(doc, leftColX + 10, ry + 8, BRAND_DARK);
        else if (iconType === "phone") drawPhoneIcon(doc, leftColX + 10, ry + 8, BRAND_DARK);
        else drawInfoIcon(doc, leftColX + 15, ry + 13, 5, BRAND_DARK);

        doc.fillColor(TEXT_MUTED).font("Helvetica-Bold").fontSize(7.5).text(label, leftColX + 26, ry + 8);
        doc.fillColor(TEXT_MAIN).font("Helvetica-Bold").fontSize(8.5).text(val, leftColX + 26, ry + 22, { width: colW - 36 });

        if (idx < donorRows.length - 1) {
          doc.moveTo(leftColX + 10, ry + rowH_left).lineTo(leftColX + colW - 10, ry + rowH_left).lineWidth(0.5).strokeColor("#F3F4F6").stroke();
        }
      });
      doc.restore();

      // Right Column
      const rightCardTitle = isApplicationPayment ? "PAYMENT DETAILS" : "DONATION DETAILS";
      doc.save();
      doc.roundedRect(rightColX, middleY, colW, colH, 6).fillAndStroke("#FFFFFF", BORDER_LIGHT);
      doc.roundedRect(rightColX, middleY, colW, 28, 6).fill(BRAND_DARK);
      doc.rect(rightColX, middleY + 14, colW, 14).fill(BRAND_DARK);
      drawListIcon(doc, rightColX + 10, middleY + 9, "#FFFFFF");
      drawTextInBox(doc, rightCardTitle, rightColX + 26, middleY, colW - 30, 28, 9, "#FFFFFF", "left", 0, "Helvetica-Bold");

      const categoryLabel = isApplicationPayment ? "Payment For" : "Donation Type";
      const categoryVal = isApplicationPayment ? "Umrah Lucky Draw Entry Fee" : (receipt.donationType || "General Sadaqah");

      const detailsRows: [string, string, boolean?][] = [
        ["Receipt No", receiptNo],
        ["Date", fullDateTimeStr],
        ["Amount", amountStr, true],
        [categoryLabel, categoryVal],
        ["Payment Status", "COMPLETED"],
        ["Transaction ID", paymentId],
        ["Order ID", orderId],
      ];

      const rowH_right = (colH - 28) / detailsRows.length;
      detailsRows.forEach(([label, val, isAmount], idx) => {
        const ry = middleY + 28 + idx * rowH_right;
        if (idx % 2 === 0) {
          doc.rect(rightColX + 1, ry, colW - 2, rowH_right).fill("#F9FAFB");
        }

        doc.fillColor(TEXT_MUTED).font("Helvetica-Bold").fontSize(7.5).text(label, rightColX + 12, ry + 10);

        if (label === "Payment Status") {
          const pillX = rightColX + colW - 95;
          const pillY = ry + 7;
          doc.roundedRect(pillX, pillY, 83, 20, 10).fill(BRAND_GREEN_PILL);
          drawCheckmark(doc, pillX + 8, pillY + 5, 8, "#FFFFFF", 1.5);
          drawCenteredTextInBox(doc, "COMPLETED", pillX + 16, pillY, 63, 20, 7.5, "#FFFFFF", undefined, 0, "Helvetica-Bold");
        } else {
          doc.fillColor(isAmount ? BRAND_DARK : TEXT_MAIN)
            .font("Helvetica-Bold")
            .fontSize(8.5)
            .text(val, rightColX + 90, ry + 10, { width: colW - 102, align: "right" });
        }

        if (idx < detailsRows.length - 1) {
          doc.moveTo(rightColX + 10, ry + rowH_right).lineTo(rightColX + colW - 10, ry + rowH_right).lineWidth(0.5).strokeColor("#F3F4F6").stroke();
        }
      });
      doc.restore();

      // 5. Lower Two Columns (Y: 466 to 616)
      const lowerY = 466;
      const lowerH = 150;
      const qrColW = 170;
      const infoColX = contentX + qrColW + 15;
      const infoColW = contentW - qrColW - 15;

      // Left Box: VERIFICATION QR CODE
      doc.save();
      doc.roundedRect(contentX, lowerY, qrColW, lowerH, 6).fillAndStroke("#FFFFFF", BORDER_LIGHT);
      doc.roundedRect(contentX, lowerY, qrColW, 26, 6).fill(BRAND_DARK);
      doc.rect(contentX, lowerY + 13, qrColW, 13).fill(BRAND_DARK);
      drawCheckmark(doc, contentX + 10, lowerY + 8, 9, "#FFFFFF", 1.5);
      drawCenteredTextInBox(doc, "VERIFICATION QR CODE", contentX + 18, lowerY, qrColW - 20, 26, 8.5, "#FFFFFF", undefined, 0, "Helvetica-Bold");

      const qrSize = 65;
      const qrX = contentX + (qrColW - qrSize) / 2;
      doc.image(qrDataUrl, qrX, lowerY + 31, { width: qrSize, height: qrSize });

      doc.fillColor(TEXT_MUTED).font("Helvetica").fontSize(5.8).text(
        "This is a unique QR code linked to your registration. It can be scanned by the foundation.",
        contentX + 8,
        lowerY + 98,
        { width: qrColW - 16, align: "center", lineGap: 1 }
      );

      doc.fillColor(TEXT_MUTED).font("Helvetica-Bold").fontSize(5.5).text("VERIFICATION ID", contentX, lowerY + 119, { width: qrColW, align: "center" });
      const idBoxW = 140;
      const idBoxX = contentX + (qrColW - idBoxW) / 2;
      drawCenteredTextInBox(doc, regNo, idBoxX, lowerY + 127, idBoxW, 18, 7.5, TEXT_MAIN, "#F3F4F6", 3, "Helvetica-Bold");
      doc.restore();

      // Right Box: IMPORTANT INFORMATION
      doc.save();
      doc.roundedRect(infoColX, lowerY, infoColW, lowerH, 6).fillAndStroke(BG_CREAM, "#E5DFD0");

      drawInfoIcon(doc, infoColX + 16, lowerY + 16, 6.5, BRAND_GOLD);
      doc.fillColor(TEXT_MAIN).font("Helvetica-Bold").fontSize(9).text("IMPORTANT INFORMATION", infoColX + 28, lowerY + 11);

      const bullets = [
        "This is an official registration document issued by Noor E Haram Charity Foundation.",
        "Keep this document safely for your records.",
        "Carry this document for verification if requested by the foundation.",
        "Winning does not guarantee travel until final verification and approval.",
        "The Trust reserves the right to verify all submitted information.",
      ];

      bullets.forEach((bulletText, i) => {
        const by = lowerY + 31 + i * 22;
        drawCheckCircle(doc, infoColX + 16, by + 4, 4.5, BRAND_DARK, "#FFFFFF");
        doc.fillColor("#374151").font("Helvetica").fontSize(7.2).text(bulletText, infoColX + 27, by + 1, { width: infoColW - 35 });
      });
      doc.restore();

      // 6. Signatures & Digital Document Section (Y: 626 to 698)
      const sigY = 626;

      if (orgSettings.seal_image_url && orgSettings.seal_image_url.startsWith("data:image")) {
        try {
          doc.image(orgSettings.seal_image_url, contentX + 15, sigY + 10, { width: 50, height: 50 });
        } catch {
          drawStampSeal(doc, contentX + 40, sigY + 36, 26);
        }
      } else {
        drawStampSeal(doc, contentX + 40, sigY + 36, 26);
      }

      doc.save();
      doc.fillColor("#6B7280").font("Helvetica-Bold").fontSize(7).text("AUTHORIZED DIGITAL SIGNATURE", contentX + 150, sigY + 8, { width: 180, align: "center" });

      let sigDrawn = false;
      if (orgSettings.signature_image_url && orgSettings.signature_image_url.startsWith("data:image")) {
        try {
          doc.image(orgSettings.signature_image_url, contentX + 190, sigY + 18, { width: 100, height: 26 });
          sigDrawn = true;
        } catch {}
      }

      if (!sigDrawn) {
        try {
          const sigPath = path.join(__dirname, "../../public/signature.png");
          if (fs.existsSync(sigPath)) {
            doc.image(sigPath, contentX + 190, sigY + 18, { width: 100, height: 26 });
          }
        } catch {}
      }

      doc.moveTo(contentX + 165, sigY + 46).lineTo(contentX + 315, sigY + 46).lineWidth(0.75).strokeColor("#6B7280").stroke();
      doc.fillColor(TEXT_MAIN).font("Helvetica-Bold").fontSize(8.5).text(orgSettings.signatory_name || "Afzal Shaikh", contentX + 150, sigY + 50, { width: 180, align: "center" });
      doc.fillColor(TEXT_MUTED).font("Helvetica-Oblique").fontSize(6.5).text("(Digitally Signed)", contentX + 150, sigY + 60, { width: 180, align: "center" });
      doc.restore();

      doc.save();
      const digW = 155;
      const digX = contentX + contentW - digW;
      doc.roundedRect(digX, sigY + 8, digW, 54, 6).fillAndStroke("#FFFFFF", BORDER_LIGHT);

      drawCheckCircle(doc, digX + 14, sigY + 22, 5, BRAND_DARK, "#FFFFFF");
      doc.fillColor(BRAND_DARK).font("Helvetica-Bold").fontSize(8).text("DIGITAL DOCUMENT", digX + 24, sigY + 18);
      doc.fillColor(TEXT_MUTED).font("Helvetica").fontSize(6.5).text(
        "This document is computer generated and digitally signed by Noor E Haram Charity Foundation.",
        digX + 10,
        sigY + 32,
        { width: digW - 20 }
      );
      doc.restore();

      // 7. Footer Banner & Legal Meta (Y: 708 to 778)
      const footerY = 708;
      const footerH = 42;

      doc.save();
      doc.roundedRect(contentX, footerY, contentW, footerH, 5).fill(BRAND_DARK);

      const fCols = [
        { label: "Phone", val: orgSettings.phone || "+91 9213408880", x: contentX + 15, w: 105 },
        { label: "Email", val: orgSettings.email || "support@nooreharam.in", x: contentX + 125, w: 125 },
        { label: "Website", val: orgSettings.website || "www.nooreharam.in", x: contentX + 255, w: 110 },
        { label: "Address", val: orgSettings.address || "Shop No. 12, Ground Floor, Mumbra, Thane - 400612", x: contentX + 370, w: 145 },
      ];

      fCols.forEach((col) => {
        doc.fillColor("#9CA3AF").font("Helvetica").fontSize(6.5).text(col.label, col.x, footerY + 8);
        doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(7.2).text(col.val, col.x, footerY + 18, { width: col.w });
      });
      doc.restore();

      doc.save();
      const sysDateStr = formatDateTime(new Date());
      doc.fillColor(TEXT_MUTED).font("Helvetica").fontSize(6.5).text(`Document Generated On: ${sysDateStr} | System Version: v1.0`, contentX, footerY + 49);
      doc.fillColor(TEXT_MUTED).font("Helvetica").fontSize(6.5).text(`© ${new Date().getFullYear()} Noor E Haram Charity Foundation. All Rights Reserved.`, contentX, footerY + 49, {
        width: contentW,
        align: "right",
      });
      doc.restore();

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

