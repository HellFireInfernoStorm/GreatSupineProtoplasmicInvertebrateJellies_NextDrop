import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyServerOptions } from "fastify";
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";
import { healthRoutes } from "./health";
import { createClock } from "./lib/clock";
import { createDatabase, type Database } from "./lib/database";
import { rateLimited, registerErrorHandling } from "./lib/errors";
import type { Readiness } from "./lib/readiness";
import { registerWebApp } from "./lib/web-app";
import { authConfigFromEnv, registerAuth, type AuthConfig } from "./modules/auth";
import { demoRoutes } from "./modules/demo";
import { feedRoutes } from "./modules/feed";
import { registerField } from "./modules/field";
import { createNotifier, notificationRoutes } from "./modules/notifications";
import { registerOrders } from "./modules/orders";
import { registerPlanning } from "./modules/planning";

export interface ServerDependencies {
  ready?: Readiness;
  database?: Database;
  auth?: Partial<AuthConfig>;
  /** Real time. Session expiry and lockout read it directly; the server clock adds the demo offset to it. */
  now?: () => Date;
  /** Rate limit for the demo clock, tick and reset routes. */
  demoRateLimit?: { max: number; timeWindowMs: number };
  /** SSE timing; defaults to a 25 s heartbeat and a 1 s shared head poll. */
  feed?: { heartbeatMs?: number; pollMs?: number };
  /** Built PWA to serve from the API's origin; defaults to WEB_DIST_DIR (set in the container), unset in dev. */
  webRoot?: string;
}

export async function buildServer(opts: FastifyServerOptions = {}, dependencies: ServerDependencies = {}) {
  const app = Fastify(opts).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  const webRoot = dependencies.webRoot ?? process.env.WEB_DIST_DIR;
  registerErrorHandling(app, webRoot ? await registerWebApp(app, webRoot) : undefined);

  const database = dependencies.database ?? (dependencies.ready ? undefined : createDatabase());
  app.decorate("prisma", database?.prisma ?? null);
  app.addHook("onClose", async () => database?.close());

  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "script-src": ["'self'"],
        "img-src": ["'self'", "data:", "blob:"],
        "connect-src": ["'self'"],
        "worker-src": ["'self'"],
        "manifest-src": ["'self'"],
        "frame-ancestors": ["'none'"],
        // The judge path is plain http://localhost (deployment.md).
        "upgrade-insecure-requests": null,
      },
    },
  });
  // Route-level only: login and reauth opt in through config.rateLimit.
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: (_request, context) => rateLimited(context.ttl),
  });
  const prisma = database?.prisma ?? null;
  const realNow = dependencies.now ?? (() => new Date());
  const authConfig = { ...authConfigFromEnv(), ...dependencies.auth };
  const clock = createClock({ prisma, realNow, demoMode: authConfig.demoMode });
  await clock.load();
  app.decorate("clock", clock);
  await registerAuth(app, { prisma, config: authConfig, now: realNow, serverTime: clock.now });

  await app.register(healthRoutes, { prefix: "/api", ready: dependencies.ready ?? database!.ready });
  await app.register(feedRoutes, {
    prisma,
    // Only the stream's session check reads it: security timing stays on real time.
    now: realNow,
    heartbeatMs: dependencies.feed?.heartbeatMs ?? 25_000,
    pollMs: dependencies.feed?.pollMs ?? 1_000,
  });
  await app.register(notificationRoutes, { prisma, now: clock.now });
  // Store cutoffs are business time: they follow the demo clock.
  await registerOrders(app, { prisma, now: clock.now });
  await registerPlanning(app, { prisma, clock });
  // Field facts are received on business time too (receivedAt, confirmed-after-sync, serverTime).
  await registerField(app, { prisma, now: clock.now });
  // Demo tooling needs the database: the clock offset, the tick and the reset all live there.
  if (prisma) {
    await app.register(demoRoutes, {
      prisma,
      schema: database?.schema ?? "public",
      clock,
      notifier: createNotifier(),
      ...(dependencies.demoRateLimit ? { rateLimit: dependencies.demoRateLimit } : {}),
    });
  }

  return app;
}

export type App = Awaited<ReturnType<typeof buildServer>>;
