/**
 * HttpError — throw from any controller or service to return a structured
 * HTTP error response via the global errorHandler middleware.
 */
export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = "HttpError";
    // Maintain proper stack trace in V8
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, HttpError);
    }
  }
}

/**
 * asyncHandler — wraps an async Express route handler so that any thrown
 * error or rejected Promise is forwarded to next() (and therefore to the
 * global errorHandler) instead of leaving the request hanging.
 *
 * Usage:
 *   router.get("/path", asyncHandler(async (req, res) => { ... }));
 */
export const asyncHandler =
  <T extends (...args: any[]) => Promise<any>>(fn: T) =>
  (...args: Parameters<T>): void => {
    const next = args[2];
    Promise.resolve(fn(...args)).catch(next);
  };
