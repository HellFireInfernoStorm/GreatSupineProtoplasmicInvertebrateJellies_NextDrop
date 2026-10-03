import type { SessionUser } from "@nextdrop/contracts";
import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import type { Actor } from "../policy";
import { DAY, type AuthConfig } from "./config";

const sessionInclude = {
  user: { include: { outlet: { select: { depot: true } }, vehicle: { select: { depot: true } } } },
} satisfies Prisma.SessionInclude;

export type SessionRecord = Prisma.SessionGetPayload<{ include: typeof sessionInclude }>;
export type AccountRecord = SessionRecord["user"];

/** Session rows, actor construction and sliding expiry (spec/platform/auth.md). */
export function createSessions(prisma: PrismaClient, config: AuthConfig, now: () => Date) {
  let allDepots: Promise<string[]> | undefined;

  /** ADR 0026: a dispatcher with `depot` set covers that depot; null covers every reference depot. */
  async function dispatcherDepots(user: Pick<AccountRecord, "depot">): Promise<string[]> {
    if (user.depot) return [user.depot];
    allDepots ??= prisma.district
      .findMany({ distinct: ["depot"], select: { depot: true }, orderBy: { depot: "asc" } })
      .then((rows) => rows.map((row) => row.depot));
    const depots = await allDepots.catch((error: unknown) => {
      allDepots = undefined;
      throw error;
    });
    // Reference data is read-only at runtime, but do not cache an unseeded database.
    if (depots.length === 0) allDepots = undefined;
    return depots;
  }

  const ttlMs = (kind: SessionRecord["kind"]) => (kind === "FIELD" ? config.fieldTtlMs : config.webTtlMs);

  return {
    dispatcherDepots,
    ttlMs,

    /** Cookie lifetime: FIELD cookies outlive expiresAt by the reauth grace window. */
    cookieMaxAgeSeconds(session: Pick<SessionRecord, "kind" | "expiresAt">): number {
      const grace = session.kind === "FIELD" ? config.fieldReauthGraceDays * DAY : 0;
      return Math.max(0, Math.ceil((session.expiresAt.getTime() + grace - now().getTime()) / 1000));
    },

    reauthDeadline(session: Pick<SessionRecord, "expiresAt">): number {
      return session.expiresAt.getTime() + config.fieldReauthGraceDays * DAY;
    },

    /** Null when the account lacks the scope its role needs; such an account cannot sign in. */
    async actorFor(user: AccountRecord, sessionId: string, deviceId: string | null): Promise<Actor | null> {
      const base = { userId: user.id, sessionId };
      switch (user.role) {
        case "STORE":
          return user.outletId && user.outlet
            ? { ...base, role: "STORE", outletId: user.outletId, depot: user.outlet.depot }
            : null;
        case "DISPATCHER": {
          const depots = await dispatcherDepots(user);
          return depots.length > 0 ? { ...base, role: "DISPATCHER", depots } : null;
        }
        case "LOADER":
          return user.depot ? { ...base, role: "LOADER", depot: user.depot, deviceId } : null;
        case "DRIVER":
          return user.vehicleId && user.vehicle
            ? { ...base, role: "DRIVER", vehicleId: user.vehicleId, depot: user.vehicle.depot, deviceId }
            : null;
      }
    },

    sessionUser(user: AccountRecord, actor: Actor): SessionUser {
      const common = { id: user.id, displayName: user.displayName, locale: user.locale };
      switch (actor.role) {
        case "STORE":
          return { ...common, role: "STORE", outletId: actor.outletId };
        case "DISPATCHER":
          return { ...common, role: "DISPATCHER", depots: [...actor.depots] };
        case "LOADER":
          return { ...common, role: "LOADER", depot: actor.depot };
        case "DRIVER":
          return { ...common, role: "DRIVER", vehicleId: actor.vehicleId };
      }
    },

    find(id: string): Promise<SessionRecord | null> {
      return prisma.session.findUnique({ where: { id }, include: sessionInclude });
    },

    async create(data: { userId: string; kind: SessionRecord["kind"]; deviceId: string | null }) {
      const expiresAt = new Date(now().getTime() + ttlMs(data.kind));
      return prisma.session.create({ data: { ...data, expiresAt }, include: sessionInclude });
    },

    /** Extend expiresAt to now + TTL. Unless forced, skips the write when it would move by less than a minute. */
    async slide(session: SessionRecord, force = false): Promise<SessionRecord> {
      const expiresAt = new Date(now().getTime() + ttlMs(session.kind));
      if (!force && expiresAt.getTime() - session.expiresAt.getTime() < 60_000) return session;
      await prisma.session.update({ where: { id: session.id }, data: { expiresAt } });
      return { ...session, expiresAt };
    },

    /** Revocation is row deletion (ADR 0024). */
    async remove(id: string): Promise<void> {
      await prisma.session.deleteMany({ where: { id } });
    },
  };
}

export type Sessions = ReturnType<typeof createSessions>;
