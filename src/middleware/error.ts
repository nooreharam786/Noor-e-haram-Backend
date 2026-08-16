import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { HttpError } from "../utils/http";
import { env } from "../config/env";

export function notFound(req: Request, _res: Response, next: NextFunction) {
  next(new HttpError(404, `Route not found: ${req.method} ${req.originalUrl}`));
}

export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction) {
  // ── Zod validation errors ───────────────────────────────────────────────
  if (error instanceof ZodError) {
    const flattened = error.flatten();
    const fieldDetails = Object.entries(flattened.fieldErrors)
      .map(([field, errs]) => (Array.isArray(errs) && errs.length ? `${field}: ${errs.join(", ")}` : null))
      .filter(Boolean)
      .join("; ");

    res.status(422).json({
      success: false,
      message: fieldDetails ? `Validation failed (${fieldDetails})` : "Validation failed",
      errors: flattened,
    });
    return;
  }

  // ── Known HTTP errors ────────────────────────────────────────────────────
  if (error instanceof HttpError) {
    res.status(error.statusCode).json({
      success: false,
      message: error.message,
      ...(error.details !== undefined ? { details: error.details } : {}),
    });
    return;
  }

  // ── Unknown / unexpected errors ──────────────────────────────────────────
  // Log full error server-side (including stack) but never expose internals
  // to the client in production
  const isProduction = env.NODE_ENV === "production";

  if (error instanceof Error) {
    console.error(`[500] ${req.method} ${req.originalUrl} — ${error.message}`);
    if (!isProduction) {
      console.error(error.stack);
    }
  } else {
    console.error(`[500] ${req.method} ${req.originalUrl} — unknown error`, error);
  }

  res.status(500).json({
    success: false,
    message: "Internal server error",
  });
}
