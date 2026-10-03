import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyServerOptions } from "fastify";
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";
import { healthRoutes } from "./health";
import { createDatabase, type Database } from "./lib/database";
import { rateLimited, registerErrorHandling } from "./lib/errors";
import type { Readiness } from "./lib/readiness";
import { authConfigFromEnv, registerAuth, type AuthConfig } from "./modules/auth";

export interface ServerDependencies {
  ready?: Readiness;
  database?: Database;
  auth?: Partial<AuthConfig>;
  /** Clock for session expiry, lockout and serverTime. */
  now?: () => Date;
}

export async function buildServer(opts: FastifyServerOptions = {}, dependencies: ServerDependencies = {}) {
  const app = Fastify(opts).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandling(app);

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
  await registerAuth(app, {
    prisma: database?.prisma ?? null,
    config: { ...authConfigFromEnv(), ...dependencies.auth },
    now: dependencies.now ?? (() => new Date()),
  });

  await app.register(healthRoutes, { prefix: "/api", ready: dependencies.ready ?? database!.ready });

  return app;
}

export type App = Awaited<ReturnType<typeof buildServer>>;
