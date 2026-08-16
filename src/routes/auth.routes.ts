import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { authRateLimit, passwordResetRateLimit } from "../middleware/authRateLimit";
import { validate } from "../middleware/validate";
import {
  forgotPassword,
  forgotPasswordSchema,
  finishOAuth,
  login,
  loginSchema,
  me,
  register,
  registerSchema,
  resetPassword,
  resetPasswordSchema,
  startOAuth,
} from "../controllers/auth.controller";

export const authRoutes = Router();

// Protected with brute-force rate limiter
authRoutes.post("/register", authRateLimit, validate(registerSchema), register);
authRoutes.post("/login", authRateLimit, validate(loginSchema), login);

// Helpful 405 for GET /login (common frontend mistake)
authRoutes.get("/login", (_req, res) => {
  res.status(405).json({ success: false, message: "Method Not Allowed. Use POST to log in." });
});

// OAuth flows
authRoutes.get("/oauth/:provider", startOAuth);
authRoutes.get("/oauth/:provider/callback", finishOAuth);
authRoutes.post("/oauth/:provider/callback", finishOAuth);

// Authenticated user profile
authRoutes.get("/me", authenticate, me);

// Password reset — stricter limiter (prevents email flooding)
authRoutes.post("/forgot-password", passwordResetRateLimit, validate(forgotPasswordSchema), forgotPassword);
authRoutes.post("/reset-password", passwordResetRateLimit, validate(resetPasswordSchema), resetPassword);
