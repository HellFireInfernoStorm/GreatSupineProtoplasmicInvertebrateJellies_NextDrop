import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

const healthResponse = z.object({ status: z.literal("ok") });

const readyResponse = z.object({
  status: z.enum(["ok", "unavailable"]),
  checks: z.record(z.string(), z.enum(["ok", "failed"])),
});

/** Public ops endpoints (spec/platform/api.md). */
export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  // Process is up.
  app.get("/healthz", { schema: { response: { 200: healthResponse } } }, async () => ({ status: "ok" as const }));

  // Ready to serve. The database and migration checks are added with the Prisma schema (#25).
  app.get("/readyz", { schema: { response: { 200: readyResponse, 503: readyResponse } } }, async () => ({
    status: "ok" as const,
    checks: {},
  }));
};
