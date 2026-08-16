import multer from "multer";
import path from "path";
import { HttpError } from "../utils/http";

/** Sanitise file names — strip directory traversal and dangerous characters */
function sanitizeFilename(original: string): string {
  return path.basename(original).replace(/[^a-zA-Z0-9._-]/g, "_");
}

export const galleryUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB per image
    files: 8,
  },
  fileFilter: (_req, file, cb) => {
    // Validate MIME type against allowlist
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!allowed.includes(file.mimetype)) {
      cb(new HttpError(422, "Only JPG, PNG, WEBP, or GIF images are allowed") as any);
      return;
    }

    // Sanitise original filename before storage (prevent path traversal)
    file.originalname = sanitizeFilename(file.originalname);
    cb(null, true);
  },
});

export const pdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB per PDF
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== "application/pdf") {
      cb(new HttpError(422, "Only PDF files are allowed") as any);
      return;
    }

    file.originalname = sanitizeFilename(file.originalname);
    cb(null, true);
  },
});
