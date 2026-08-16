import { z } from "zod";
import { asyncHandler, HttpError } from "../../utils/http";
import { prisma } from "../../config/prisma";
import { logAdminAction } from "../../services/audit.service";
import { hashPassword, comparePassword } from "../../utils/security";
import { strongPassword } from "../../utils/validation";

export const changePasswordSchema = z.object({
  body: z.object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: strongPassword,
  }),
});

export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const adminId = req.user!.id;

  const admin = await prisma.user.findUnique({ where: { id: adminId } });
  if (!admin) {
    throw new HttpError(404, "Admin account not found");
  }

  const isValid = await comparePassword(currentPassword, admin.password);
  if (!isValid) {
    throw new HttpError(401, "Current password is incorrect");
  }

  if (currentPassword === newPassword) {
    throw new HttpError(400, "New password must be different from the current password");
  }

  const hashedPassword = await hashPassword(newPassword);
  await prisma.user.update({
    where: { id: adminId },
    data: { password: hashedPassword },
  });

  await logAdminAction(adminId, "CHANGE_PASSWORD", "User", adminId, undefined, req.ip);
  res.json({ success: true, message: "Password updated successfully" });
});

export const invalidateSessions = asyncHandler(async (req, res) => {
  const adminId = req.user!.id;

  // Bump updatedAt — a token-version check in authenticate could enforce this.
  // Currently JWT tokens remain valid until expiry (stateless).
  // For full invalidation, use a token blocklist or a tokenVersion field.
  await prisma.user.update({
    where: { id: adminId },
    data: { updatedAt: new Date() },
  });

  await logAdminAction(adminId, "INVALIDATE_SESSIONS", "User", adminId, undefined, req.ip);
  res.json({
    success: true,
    message: "Session invalidation requested. Existing tokens expire at their natural TTL.",
  });
});
