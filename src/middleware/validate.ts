import { NextFunction, Request, Response } from "express";
import { AnyZodObject } from "zod";

/**
 * Zod validation middleware.
 * Parses req.body, req.query, and req.params through the schema.
 * Passes ZodError to next() so the global error handler returns a structured 422.
 * Also mutates req with coerced/defaulted values from the schema.
 */
export function validate(schema: AnyZodObject) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const parsed = schema.parse({
        body: req.body,
        query: req.query,
        params: req.params,
      });

      // Replace with coerced/sanitised values (e.g. numbers, trimmed strings)
      if (parsed.body   !== undefined) req.body   = parsed.body;
      if (parsed.query  !== undefined) req.query  = parsed.query as any;
      if (parsed.params !== undefined) req.params = parsed.params as any;

      next();
    } catch (err) {
      next(err); // ZodError → global errorHandler → 422
    }
  };
}
