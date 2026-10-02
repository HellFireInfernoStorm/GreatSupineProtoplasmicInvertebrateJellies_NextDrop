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
