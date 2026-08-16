import { prisma } from "../config/prisma";
import { asyncHandler, HttpError } from "../utils/http";
import { logError } from "../utils/logger";

export const serveGalleryImage = asyncHandler(async (req, res) => {
  const image = await prisma.galleryItem.findUnique({
    where: { id: req.params.id }
  });

  if (!image) {
    throw new HttpError(404, "Gallery image not found");
  }

  res.redirect(image.imageUrl);
});

export const servePublicDocument = asyncHandler(async (req, res) => {
  try {
  const document = await prisma.publicDocument.findUnique({
    where: { id: req.params.id }
  });

  if (!document) {
    throw new HttpError(404, "Document not found");
  }

  const isDownload = req.query.download === "1" || req.query.download === "true";

  // ── Mode 1: Redirect to Supabase CDN (new documents) ───────────────────
  if (document.storageUrl) {
    // For downloads, append ?download= query param so the browser triggers save-as
    // Supabase public URLs support content-disposition via the 'download' query param
    if (isDownload) {
      const separator = document.storageUrl.includes("?") ? "&" : "?";
      const downloadUrl = `${document.storageUrl}${separator}download=${encodeURIComponent(document.filename || "document.pdf")}`;
      res.redirect(302, downloadUrl);
    } else {
      res.redirect(302, document.storageUrl);
    }
    return;
  }

  // ── Mode 2: Stream from DB blob (legacy documents, pre-migration) ──────
  if (!document.data) {
    throw new HttpError(404, "Document content not available");
  }

  const fileBuffer = Buffer.from(document.data);

  // Allow PDF preview in browser embeds/iframes
  res.removeHeader("X-Frame-Options");
  res.removeHeader("Content-Security-Policy");
  res.setHeader("Content-Security-Policy", "frame-ancestors *;");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Content-Type", document.contentType || "application/pdf");
  res.setHeader("Content-Length", String(fileBuffer.length));

  const disposition = isDownload ? "attachment" : "inline";
  const safeFilename = encodeURIComponent(document.filename || "document.pdf");
  const rawFilename = (document.filename || "document.pdf").replace(/["\r\n]/g, "_");

  res.setHeader(
    "Content-Disposition",
    `${disposition}; filename="${rawFilename}"; filename*=UTF-8''${safeFilename}`
  );
  res.setHeader("Cache-Control", "public, max-age=86400, immutable");

  res.send(fileBuffer);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    logError("PUBLIC_DOCUMENT_SERVE", error, { documentId: req.params.id });
    throw new HttpError(404, "Document is currently unavailable");
  }
});
