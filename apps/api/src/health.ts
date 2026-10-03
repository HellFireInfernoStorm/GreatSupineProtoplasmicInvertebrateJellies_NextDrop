import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Readiness } from "./lib/readiness";

const healthResponse = z.object({ status: z.literal("ok") });

const readyResponse = z.object({
  status: z.enum(["ok", "unavailable"]),
  checks: z.record(z.string(), z.enum(["ok", "failed"])),
});

/** Public ops endpoints (spec/platform/api.md). */
export const healthRoutes: FastifyPluginAsyncZod<{ ready: Readiness }> = async (app, { ready }) => {
  // Process is up.
  app.get("/healthz", { schema: { response: { 200: healthResponse } } }, async () => ({ status: "ok" as const }));

  app.get("/readyz", { schema: { response: { 200: readyResponse, 503: readyResponse } } }, async (_request, reply) => {
    const result = await ready();
    return reply.code(result.status === "ok" ? 200 : 503).send(result);
  });
};
