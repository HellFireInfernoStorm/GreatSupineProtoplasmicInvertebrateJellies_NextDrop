import type { PrismaClient } from "../../generated/prisma/client";
import type { FeedHint } from "./hub";

/** The committed feed head and the demo reset epoch (0 until the seed creates DemoState), as wire strings. */
export async function readFeedHint(prisma: PrismaClient): Promise<FeedHint> {
  const [counter, demo] = await Promise.all([
    prisma.feedCounter.findUniqueOrThrow({ where: { singleton: true }, select: { head: true } }),
    prisma.demoState.findUnique({ where: { singleton: true }, select: { resetEpoch: true } }),
  ]);
  return { head: counter.head.toString(), resetEpoch: demo?.resetEpoch ?? 0 };
}
