// Background jobs on pg-boss (spec/platform/stack-and-layout.md): the planning-day tick, every minute.
import { PgBoss } from "pg-boss";

export const TICK_QUEUE = "planning-tick";
export const TICK_CRON = "* * * * *";

export interface Jobs {
  readonly boss: PgBoss;
  stop(): Promise<void>;
}

export interface JobDependencies {
  connectionString: string;
  /** pg-boss keeps its own tables in this schema. */
  schema?: string;
  /** Applies time-driven transitions; returns how many it applied. */
  tick: () => Promise<number>;
  log: { info: (obj: object, msg: string) => void; error: (obj: object, msg: string) => void };
}

export async function startJobs(deps: JobDependencies): Promise<Jobs> {
  const boss = new PgBoss({ connectionString: deps.connectionString, schema: deps.schema ?? "pgboss" });
  boss.on("error", (err) => deps.log.error({ err }, "pg-boss error"));
  await boss.start();
  await boss.createQueue(TICK_QUEUE);
  await boss.schedule(TICK_QUEUE, TICK_CRON);
  await boss.work(TICK_QUEUE, async () => {
    const transitionsApplied = await deps.tick();
    if (transitionsApplied > 0) deps.log.info({ transitionsApplied }, "planning tick");
  });
  return { boss, stop: () => boss.stop({ graceful: true }) };
}
