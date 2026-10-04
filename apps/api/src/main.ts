import { runSeed } from "../prisma/seed";
import { startJobs } from "./modules/jobs";
import { createNotifier } from "./modules/notifications";
import { tickPlanningDays } from "./modules/planning";
import { buildServer } from "./server";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";
const pretty = process.env.NODE_ENV !== "production" && process.stdout.isTTY;

const app = await buildServer({
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
    ...(pretty ? { transport: { target: "pino-pretty" } } : {}),
  },
});

if (process.env.SEED_ON_START === "true") {
  if (!app.prisma) throw new Error("SEED_ON_START=true needs DATABASE_URL.");
  app.log.info({ seed: await runSeed(app.prisma) }, "seed finished");
}

// The planning-day tick every minute (spec/planning/flow.md §8.1). JOBS_ENABLED=false turns it off.
// Hooks must be added before listen(): Fastify refuses addHook on a listening instance.
const prisma = app.prisma;
if (prisma && process.env.DATABASE_URL && process.env.JOBS_ENABLED !== "false") {
  const notifier = createNotifier(app.clock.now);
  const jobs = await startJobs({
    connectionString: process.env.DATABASE_URL,
    tick: () => tickPlanningDays(prisma, app.clock.now(), notifier),
    log: app.log,
  });
  app.addHook("onClose", () => jobs.stop());
}

try {
  await app.listen({ port, host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
