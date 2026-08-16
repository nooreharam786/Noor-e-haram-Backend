import crypto from "crypto";
import bcrypt from "bcryptjs";
import jwt, { SignOptions, TokenExpiredError, JsonWebTokenError } from "jsonwebtoken";
import { Role } from "@prisma/client";
import { env } from "../config/env";
import { HttpError } from "./http";

export type JwtPayload = {
  sub: string;
  email: string;
  role: Role;
  iat?: number;
  exp?: number;
};

export function signAccessToken(payload: Omit<JwtPayload, "iat" | "exp">): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
    issuer: "noor-e-haram",
    audience: "noor-e-haram-client",
  } as SignOptions);
}

export function verifyAccessToken(token: string): JwtPayload {
  try {
    return jwt.verify(token, env.JWT_SECRET, {
      issuer: "noor-e-haram",
      audience: "noor-e-haram-client",
    }) as JwtPayload;
  } catch (err) {
    if (err instanceof TokenExpiredError) {
      throw new HttpError(401, "Session expired. Please log in again.");
    }
    if (err instanceof JsonWebTokenError) {
      throw new HttpError(401, "Invalid token.");
    }
    throw new HttpError(401, "Authentication failed.");
  }
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function createResetToken(): { token: string; tokenHash: string } {
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  return { token, tokenHash };
}
