// The server clock (spec/data/seed-and-demo.md §15.2): `now = realNow + offset`. Every cutoff, state-transition and
// ETA path, and every `serverTime` in a response, reads it. The offset lives in `DemoState.clockOffsetMs` and only
// applies with DEMO_MODE. Session expiry, lockout and other security timing keep real time (ADR 0033).
import type { PrismaClient } from "../generated/prisma/client";

declare module "fastify" {
  interface FastifyInstance {
    clock: Clock;
  }
}

export interface Clock {
  /** Business time: real time plus the demo offset. */
  now(): Date;
  /** Real time, for security timing. */
  realNow(): Date;
  offsetMs(): number;
  /** Moves the clock so `now()` reads `serverTime`, and stores the offset. Returns the new offset. */
  set(serverTime: Date): Promise<number>;
  /** Reads the stored offset (startup, or after another writer changed it). */
  load(): Promise<void>;
}

export function createClock(opts: {
  prisma: PrismaClient | null;
  realNow?: () => Date;
  /** Without demo mode the offset is always 0 and `set` is refused. */
  demoMode: boolean;
}): Clock {
  const realNow = opts.realNow ?? (() => new Date());
  let offset = 0;
  return {
    now: () => new Date(realNow().getTime() + offset),
    realNow,
    offsetMs: () => offset,
    async set(serverTime) {
      if (!opts.demoMode) throw new Error("The server clock can only be moved with DEMO_MODE=true");
      if (!opts.prisma) throw new Error("Moving the server clock needs a database");
      const next = serverTime.getTime() - realNow().getTime();
      await opts.prisma.demoState.upsert({
        where: { singleton: true },
        create: { preset: "before-cutoff", clockOffsetMs: BigInt(next) },
        update: { clockOffsetMs: BigInt(next) },
      });
      offset = next;
      return offset;
    },
    async load() {
      if (!opts.demoMode || !opts.prisma) {
        offset = 0;
        return;
      }
      const state = await opts.prisma.demoState.findUnique({ where: { singleton: true } }).catch(() => null);
      offset = state ? Number(state.clockOffsetMs) : 0;
    },
  };
}
