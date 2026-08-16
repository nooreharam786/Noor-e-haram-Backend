import rateLimit from "express-rate-limit";

/**
 * Strict rate limiter for authentication endpoints.
 * Protects against brute-force login/register/reset attacks.
 * 10 requests per 15 minutes per IP.
 */
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many authentication attempts. Please try again in 15 minutes.",
  },
  skipSuccessfulRequests: false,
});

/**
 * Slightly looser rate limiter for password reset (forgot password).
 * Prevents email flooding.
 * 5 requests per hour per IP.
 */
export const passwordResetRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many password reset requests. Please try again in an hour.",
  },
});
