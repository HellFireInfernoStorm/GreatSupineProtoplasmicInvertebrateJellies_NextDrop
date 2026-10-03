import { describe, expect, it } from "vitest";
import type { PrismaClient } from "../generated/prisma/client";
import { createClock } from "./clock";

const REAL = new Date("2026-10-03T12:00:00.000Z");

function fakePrisma(stored: { clockOffsetMs: bigint } | null) {
  const writes: bigint[] = [];
  const prisma = {
    demoState: {
      findUnique: async () => stored,
      upsert: async ({ update }: { update: { clockOffsetMs: bigint } }) => {
        writes.push(update.clockOffsetMs);
        return {};
      },
    },
  } as unknown as PrismaClient;
  return { prisma, writes };
}

describe("server clock", () => {
  it("reads real time plus the stored offset in demo mode", async () => {
    const { prisma } = fakePrisma({ clockOffsetMs: -60_000n });
    const clock = createClock({ prisma, realNow: () => REAL, demoMode: true });
    expect(clock.now()).toEqual(REAL);
    await clock.load();
    expect(clock.offsetMs()).toBe(-60_000);
    expect(clock.now()).toEqual(new Date(REAL.getTime() - 60_000));
    expect(clock.realNow()).toEqual(REAL);
  });

  it("moves to a server time and stores the offset", async () => {
    const { prisma, writes } = fakePrisma(null);
    const clock = createClock({ prisma, realNow: () => REAL, demoMode: true });
    const target = new Date("2026-09-28T08:30:00.000Z");
    await clock.set(target);
    expect(clock.now()).toEqual(target);
    expect(writes).toEqual([BigInt(target.getTime() - REAL.getTime())]);
  });

  it("ignores a stored offset and refuses to move without demo mode", async () => {
    const { prisma } = fakePrisma({ clockOffsetMs: 5_000n });
    const clock = createClock({ prisma, realNow: () => REAL, demoMode: false });
    await clock.load();
    expect(clock.now()).toEqual(REAL);
    await expect(clock.set(new Date(0))).rejects.toThrow(/DEMO_MODE/);
  });
});
