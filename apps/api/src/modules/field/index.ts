// Field roles (spec/sync): scoped snapshot, idempotent event push ingest and device heartbeat.
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "../../generated/prisma/client";
import { createNotifier } from "../notifications";
import { createIngest } from "./ingest";
import { fieldRoutes } from "./routes";

export { LATE_GRACE_MIN, reasonLists, snapshotConfig } from "./config";
export { createIngest, type Ingest } from "./ingest";
export { SYNC_BODY_LIMIT } from "./routes";
export { buildSnapshot } from "./snapshot";

export async function registerField(app: FastifyInstance, deps: { prisma: PrismaClient | null; now: () => Date }) {
  if (!deps.prisma) return;
  const ingest = createIngest({ prisma: deps.prisma, now: deps.now, notifier: createNotifier() });
  await app.register(fieldRoutes, { prisma: deps.prisma, now: deps.now, ingest });
}
