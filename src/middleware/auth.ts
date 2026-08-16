import { NextFunction, Request, Response } from "express";
import { Role } from "@prisma/client";
import { prisma } from "../config/prisma";
import { HttpError } from "../utils/http";
import { verifyAccessToken } from "../utils/security";

// Augment Express Request with typed user field
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        role: Role;
      };
    }
  }
}

/**
 * Authenticate the request by verifying the Bearer JWT.
 * Attaches req.user on success or calls next(HttpError 401) on failure.
 */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    let token: string | undefined;
    const header = req.headers.authorization;

    if (header?.startsWith("Bearer ")) {
      token = header.slice(7).trim();
    } else if (typeof req.query.token === "string" && req.query.token.trim()) {
      token = req.query.token.trim();
    }

    if (!token) {
      throw new HttpError(401, "Missing or malformed authorization header");
    }

    // Verify JWT signature + expiry (throws JsonWebTokenError / TokenExpiredError)
    const payload = verifyAccessToken(token);

    // Confirm user still exists in DB (handles deleted/deactivated accounts)
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, role: true },
    });

    if (!user) {
      throw new HttpError(401, "Account not found or has been deactivated");
    }

    req.user = user;
    next();
  } catch (err) {
    if (err instanceof HttpError) {
      next(err);
    } else {
      // JWT errors (expired, invalid signature etc.) should be 401, not 500
      next(new HttpError(401, "Invalid or expired token"));
    }
  }
}

/**
 * Require the authenticated user to have the admin role.
 * Must be used AFTER authenticate().
 */
export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user || req.user.role !== Role.admin) {
    next(new HttpError(403, "Admin access required"));
    return;
  }
  next();
}

/**
 * Optionally authenticate — attaches req.user if a valid token is present,
 * but does NOT reject if the header is missing or invalid.
 */
export async function optionalAuthenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) return next();

    const token = header.slice(7).trim();
    if (!token) return next();

    const payload = verifyAccessToken(token);
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, role: true },
    });

    if (user) req.user = user;
  } catch {
    // Silently ignore auth errors in optional mode
  }
  next();
}
