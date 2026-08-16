import type { Request } from "express";
import { env } from "../config/env";

const localUploadUrlPattern = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\/uploads\/gallery\//i;

export function requestOrigin(req: Request) {
  if (env.API_PUBLIC_URL) {
    return env.API_PUBLIC_URL.replace(/\/+$/, "");
  }
  const protoHeader = req.headers["x-forwarded-proto"];
  const rawProtocol = Array.isArray(protoHeader) ? protoHeader[0] : protoHeader;
  const forwardedProtocol = rawProtocol?.split(",")[0].trim().toLowerCase();
  const protocol = forwardedProtocol === "https" || forwardedProtocol === "http" ? forwardedProtocol : (req.protocol === "https" ? "https" : "http");
  const hostHeader = req.headers.host;
  const host = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader;
  if (!host || /[\r\n]/.test(host)) return env.FRONTEND_URL.replace(/\/+$/, "");
  return `${protocol}://${host}`;
}

export function galleryImageUrl(req: Request, id: string) {
  return `${requestOrigin(req)}/uploads/gallery/${id}`;
}

export function publicDocumentUrl(req: Request, id: string) {
  return `${requestOrigin(req)}/uploads/documents/${id}`;
}

export function splitGalleryUrls(value?: string) {
  return (value ?? "")
    .split(/\r?\n/)
    .map((url) => url.trim())
    .filter((url) => url && !localUploadUrlPattern.test(url));
}

export function joinGalleryUrls(value?: string) {
  return splitGalleryUrls(value).join("\n");
}
