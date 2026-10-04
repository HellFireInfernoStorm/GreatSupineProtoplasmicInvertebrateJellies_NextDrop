import type { ApiDto } from "@nextdrop/contracts";
import { colomboInstant, colomboLocal } from "@nextdrop/rules";
import type { PrismaClient } from "../../generated/prisma/client";
import { LATE_GRACE_MIN } from "../field";
import { dateOnly, NO_SIGNAL_AFTER_MIN, toTripDto, tripInclude, type TripRecord } from "../orders";
import { toVehicleDto, vehicleInclude } from "../reference";

type RunState = ApiDto<"run">["state"];
const MINUTE = 60_000;
/** A stop is done once its outcome is in: delivered (and later received or disputed) or failed. */
const DONE: ReadonlySet<string> = new Set(["DELIVERED", "RECEIVED", "DISPUTED", "FAILED"]);

export interface RunSignal {
  lastHeardAt: Date | null;
  lastSyncAt: Date | null;
  pendingCount: number;
}

/**
 * The D4 state of one vehicle's run (spec/platform/notifications-and-monitoring.md, ADR 0041), on the server clock:
 * - `DONE` when every stop has an outcome (or every trip is complete);
 * - `NO_SIGNAL` while a departed run has not been heard for `NO_SIGNAL_AFTER_MIN`;
 * - `BEHIND` once the next open stop is past its ETA by `BEHIND_GRACE_MIN`; `ESCALATED` is both.
 * `lateRisk` is set as soon as the next open stop is past its ETA, before the grace runs out.
 */
export function runState(
  date: string,
  trips: readonly TripRecord[],
  signal: RunSignal,
  now: Date,
): { stopsDone: number; stopsTotal: number; lateRisk: boolean; state: RunState } {
  const stops = [...trips]
    .sort((a, b) => a.plannedDepart - b.plannedDepart || a.tripNo - b.tripNo)
    .flatMap((trip) => trip.stops);
  const stopsDone = stops.filter((s) => DONE.has(s.order.status)).length;
  const stopsTotal = stops.length;
  const done = (stopsTotal > 0 && stopsDone === stopsTotal) || trips.every((t) => t.status === "COMPLETE");
  const next = stops.find((s) => !DONE.has(s.order.status));
  const late = next ? now.getTime() - colomboInstant(date, next.etaMin) : -Infinity;
  const lateRisk = !done && late > 0;
  const behind = !done && late > LATE_GRACE_MIN * MINUTE;
  const active = trips.some((t) => t.status === "DEPARTED");
  const silent =
    active &&
    (signal.lastHeardAt === null || now.getTime() - signal.lastHeardAt.getTime() > NO_SIGNAL_AFTER_MIN * MINUTE);
  const state: RunState = done
    ? "DONE"
    : silent && behind
      ? "ESCALATED"
      : silent
        ? "NO_SIGNAL"
        : behind
          ? "BEHIND"
          : "ON_TRACK";
  return { stopsDone, stopsTotal, lateRisk, state };
}

/** Signal per vehicle from its drivers' devices: heartbeats and accepted pushes both move `lastSeenAt`. */
export async function vehicleSignals(prisma: PrismaClient, vehicleIds: readonly string[]) {
  const devices = await prisma.device.findMany({
    where: { user: { role: "DRIVER", vehicleId: { in: [...vehicleIds] } } },
    select: { lastSeenAt: true, lastSyncAt: true, pendingCount: true, user: { select: { vehicleId: true } } },
    orderBy: { lastSeenAt: "asc" },
  });
  const signals = new Map<string, RunSignal>();
  // Ordered by lastSeenAt, so the last device seen wins: its time and pending count are the current ones.
  for (const device of devices) {
    const vehicleId = device.user.vehicleId!;
    const synced = [signals.get(vehicleId)?.lastSyncAt, device.lastSyncAt].filter((d): d is Date => d instanceof Date);
    signals.set(vehicleId, {
      lastHeardAt: device.lastSeenAt,
      lastSyncAt: synced.length ? new Date(Math.max(...synced.map((d) => d.getTime()))) : null,
      pendingCount: device.pendingCount,
    });
  }
  return signals;
}

/** `GET /dispatch/runs`: today's runs in the depot, one per vehicle with trips. */
export async function listRuns(prisma: PrismaClient, depot: string, now: Date): Promise<ApiDto<"run">[]> {
  const date = colomboLocal(now.getTime()).date;
  const trips = await prisma.trip.findMany({
    where: { status: { not: "CANCELLED" }, planningDay: { depot, date: dateOnly(date) } },
    include: tripInclude(),
    orderBy: [{ plannedDepart: "asc" }, { tripNo: "asc" }],
  });
  const vehicleIds = [...new Set(trips.map((t) => t.vehicleId))];
  const [vehicles, signals] = await Promise.all([
    prisma.vehicle.findMany({
      where: { id: { in: vehicleIds } },
      include: vehicleInclude,
      orderBy: { displayId: "asc" },
    }),
    vehicleSignals(prisma, vehicleIds),
  ]);
  return vehicles.map((vehicle) => {
    const own = trips.filter((t) => t.vehicleId === vehicle.id);
    const signal = signals.get(vehicle.id) ?? { lastHeardAt: null, lastSyncAt: null, pendingCount: 0 };
    return {
      vehicle: toVehicleDto(vehicle),
      trips: own.map(toTripDto),
      ...runState(date, own, signal, now),
      lastHeardAt: signal.lastHeardAt?.toISOString() ?? null,
      lastSyncAt: signal.lastSyncAt?.toISOString() ?? null,
      pendingCount: signal.pendingCount,
    };
  });
}
