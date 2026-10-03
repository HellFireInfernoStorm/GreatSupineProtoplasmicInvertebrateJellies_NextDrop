import Fastify, { type FastifyServerOptions } from "fastify";
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";
import { healthRoutes } from "./health";
import { createDatabase, type Database } from "./lib/database";
import type { Readiness } from "./lib/readiness";

export async function buildServer(
  opts: FastifyServerOptions = {},
  dependencies: { ready?: Readiness; database?: Database } = {},
) {
  const app = Fastify(opts).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const database = dependencies.database ?? (dependencies.ready ? undefined : createDatabase());
  app.decorate("prisma", database?.prisma ?? null);
  app.addHook("onClose", async () => database?.close());
  await app.register(healthRoutes, { prefix: "/api", ready: dependencies.ready ?? database!.ready });

  return app;
}

export type App = Awaited<ReturnType<typeof buildServer>>;
