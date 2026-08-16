/** Lightweight structured logging that is safe to use in serverless runtimes. */
export function logEvent(event: string, fields: Record<string, unknown> = {}) {
  console.info(JSON.stringify({ event, timestamp: new Date().toISOString(), ...fields }));
}

export function logError(event: string, error: unknown, fields: Record<string, unknown> = {}) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ event, level: "error", timestamp: new Date().toISOString(), message, ...fields }));
}
