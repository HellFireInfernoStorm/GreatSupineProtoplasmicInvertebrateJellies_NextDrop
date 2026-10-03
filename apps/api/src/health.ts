import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Readiness } from "./lib/readiness";
import { publicResource } from "./modules/policy";

const healthResponse = z.object({ status: z.literal("ok") });

const readyResponse = z.object({
  status: z.enum(["ok", "unavailable"]),
  checks: z.record(z.string(), z.enum(["ok", "failed"])),
});

/** Public ops endpoints (spec/platform/api.md). */
export const healthRoutes: FastifyPluginAsyncZod<{ ready: Readiness }> = async (app, { ready }) => {
  // Process is up.
  app.get(
    "/healthz",
    {
      schema: { response: { 200: healthResponse } },
      config: { policy: { action: "health", resourceResolver: publicResource } },
    },
    async () => ({ status: "ok" as const }),
  );

  app.get(
    "/readyz",
    {
      schema: { response: { 200: readyResponse, 503: readyResponse } },
      config: { policy: { action: "ready", resourceResolver: publicResource } },
    },
    async (_request, reply) => {
      const result = await ready();
      return reply.code(result.status === "ok" ? 200 : 503).send(result);
    },
  );
};
