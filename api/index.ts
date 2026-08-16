/**
 * Vercel Serverless Function Entry Point
 *
 * Vercel's @vercel/node runtime requires the default export to be a
 * function matching the signature: (req: IncomingMessage, res: ServerResponse) => void
 *
 * Express apps are compatible with this signature because express() returns
 * a function that accepts (req, res, next). We export it directly as default.
 *
 * IMPORTANT: app.listen() must NEVER be called in this module or any module
 * it imports at runtime. See src/server.ts — listen is guarded by
 * VERCEL env check so it only runs during local development.
 */
import app from "../src/app";
import type { IncomingMessage, ServerResponse } from "http";

export default function handler(req: IncomingMessage, res: ServerResponse): void {
  app(req, res);
}
