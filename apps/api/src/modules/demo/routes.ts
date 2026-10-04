import {
  demoClockRequestSchema,
  demoResetRequestSchema,
  demoStateSchema,
  demoTickResponseSchema,
  mutationHeadersSchema,
  type HumanRole,
} from "@nextdrop/contracts";
import type { FastifyRequest } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { z } from "zod";
import type { PrismaClient } from "../../generated/prisma/client";
import type { Clock } from "../../lib/clock";
import { ApiHttpError } from "../../lib/errors";
import type { Notifier } from "../notifications";
import { tickPlanningDays } from "../planning";
import { collectionResource } from "../policy";
import { BUILT_PRESETS, resetToPreset } from "./presets";

export interface DemoRouteDependencies {
  prisma: PrismaClient | null;
  schema: string;
  clock: Clock;
  notifier: Notifier;
  /** Per-route limit for clock and reset (spec §15.2: rate-limited). */
  rateLimit?: { max: number; timeWindowMs: number };
}

type DemoState = z.infer<typeof demoStateSchema>;

/** `GET /demo/state`, `POST /demo/clock`, `POST /demo/tick`, `POST /demo/reset` (spec/platform/api.md). */
export const demoRoutes: FastifyPluginAsyncZod<DemoRouteDependencies> = async (app, deps) => {
  const database = () => {
    if (!deps.prisma) throw new Error("The demo module needs a database");
    return deps.prisma;
  };
  const limit = deps.rateLimit ?? { max: 10, timeWindowMs: 60_000 };
  const rateLimit = { max: limit.max, timeWindow: limit.timeWindowMs };

  async function state(): Promise<DemoState> {
    const row = await database().demoState.findUnique({
      where: { singleton: true },
      include: { lastResetByUser: { select: { role: true } } },
    });
    return {
      enabled: true,
      serverTime: deps.clock.now().toISOString(),
      clockOffsetMs: deps.clock.offsetMs(),
      preset: demoStateSchema.shape.preset.safeParse(row?.preset).data ?? "before-cutoff",
      resetEpoch: row?.resetEpoch ?? 0,
      lastResetBy: (row?.lastResetByUser?.role as HumanRole | undefined) ?? null,
      lastResetAt: row?.lastResetAt?.toISOString() ?? null,
    };
  }

  /** The dispatcher who acted, or null for the script key. */
  const actorId = (request: FastifyRequest) => (request.scriptKeyAccess ? null : (request.actor?.userId ?? null));

  app.get(
    "/api/demo/state",
    {
      schema: { response: { 200: demoStateSchema } },
      config: { policy: { action: "demoState", resourceResolver: collectionResource } },
    },
    async () => state(),
  );

  app.post(
    "/api/demo/clock",
    {
      schema: { headers: mutationHeadersSchema, body: demoClockRequestSchema, response: { 200: demoStateSchema } },
      config: { policy: { action: "demoClock", resourceResolver: collectionResource }, rateLimit },
    },
    async (request) => {
      await deps.clock.set(new Date(request.body.serverTime));
      request.log.info({ actorUserId: actorId(request), serverTime: request.body.serverTime }, "demo clock moved");
      return state();
    },
  );

  app.post(
    "/api/demo/tick",
    {
      schema: { headers: mutationHeadersSchema, response: { 200: demoTickResponseSchema } },
      config: { policy: { action: "demoTick", resourceResolver: collectionResource }, rateLimit },
    },
    async () => {
      const transitionsApplied = await tickPlanningDays(database(), deps.clock.now(), deps.notifier);
      return { transitionsApplied, serverTime: deps.clock.now().toISOString() };
    },
  );

  app.post(
    "/api/demo/reset",
    {
      schema: { headers: mutationHeadersSchema, body: demoResetRequestSchema, response: { 200: demoStateSchema } },
      config: { policy: { action: "demoReset", resourceResolver: collectionResource }, rateLimit },
    },
    async (request) => {
      const { preset } = request.body;
      // A preset that is not built yet (clash-ready waits on #145) answers 409.
      if (!BUILT_PRESETS.has(preset)) {
        throw new ApiHttpError(409, "ILLEGAL_TRANSITION", "errors.demoPresetUnavailable", { preset });
      }
      await resetToPreset(
        { prisma: database(), schema: deps.schema, clock: deps.clock, notifier: deps.notifier },
        preset,
        actorId(request),
      );
      request.log.info({ actorUserId: actorId(request), preset }, "demo reset");
      return state();
    },
  );
};
