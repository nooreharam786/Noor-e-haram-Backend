import { prisma } from "../config/prisma";

/**
 * Log an admin action to the audit trail.
 * Audit failures must NEVER break the main request — they are fire-and-forget.
 * However, failures ARE logged to stderr for monitoring/alerting.
 */
export async function logAdminAction(
  adminId: string,
  action: string,
  entity: string,
  entityId?: string,
  details?: unknown,
  ipAddress?: string,
  oldStatus?: string,
  newStatus?: string
): Promise<void> {
  try {
    // Serialize details safely — never expose raw objects in the DB column
    let detailsStr: string | null = null;
    if (details !== undefined && details !== null) {
      try {
        detailsStr = typeof details === "string" ? details : JSON.stringify(details);
      } catch {
        detailsStr = String(details);
      }
    }

    await prisma.auditLog.create({
      data: {
        adminId,
        action,
        entity,
        entityId: entityId ?? null,
        details: detailsStr,
        ipAddress: ipAddress ?? null,
        oldStatus: oldStatus ?? null,
        newStatus: newStatus ?? null,
      },
    });
  } catch (err) {
    // Log to stderr but do NOT rethrow — audit must never break business logic
    console.error(
      `[audit] Failed to log action "${action}" on ${entity}/${entityId ?? "?"}:`,
      err instanceof Error ? err.message : String(err)
    );
  }
}
