import {
  SCHEMA_VERSION,
  upcastPayload,
  type EventEnvelope,
  type EventPayloadMap,
  type EventType,
} from "@nextdrop/contracts";
import type { OrderEvent } from "@nextdrop/rules";
import type { OrderEvent as OrderEventRow, Prisma, Role } from "../../generated/prisma/client";

/** Payload at the current schema version: stored payloads are upcast on read, never rewritten. */
function currentPayload(row: OrderEventRow): unknown {
  return upcastPayload(row.type as EventType, row.schemaVersion, row.payload);
}

/** The reducer's view of a stored event. */
export function toRulesEvent(row: OrderEventRow): OrderEvent {
  return {
    id: row.id,
    type: row.type,
    disposition: row.disposition,
    subject: { ...(row.orderId ? { orderId: row.orderId } : {}), ...(row.tripId ? { tripId: row.tripId } : {}) },
    payload: currentPayload(row),
  } as OrderEvent;
}

/** The wire envelope (contracts). `capturedAt` and `clockOffsetMs` are shown beside each entry, never used to order. */
export function toEnvelope(row: OrderEventRow): EventEnvelope {
  return {
    id: row.id,
    type: row.type,
    ...(row.clientEventId ? { clientEventId: row.clientEventId } : {}),
    ...(row.deviceId ? { deviceId: row.deviceId } : {}),
    ...(row.deviceSeq === null ? {} : { deviceSeq: row.deviceSeq }),
    schemaVersion: SCHEMA_VERSION,
    subject: {
      ...(row.orderId ? { orderId: row.orderId } : {}),
      ...(row.tripId ? { tripId: row.tripId } : {}),
      ...(row.vehicleId ? { vehicleId: row.vehicleId } : {}),
    },
    source: row.source,
    actor: { userId: row.actorUserId, role: row.actorRole },
    capturedAt: row.capturedAt.toISOString(),
    ...(row.clockOffsetMs === null ? {} : { clockOffsetMs: Number(row.clockOffsetMs) }),
    receivedAt: row.receivedAt.toISOString(),
    ...(row.basedOnPlanVersion === null ? {} : { basedOnPlanVersion: row.basedOnPlanVersion }),
    disposition: row.disposition,
    payload: currentPayload(row),
  } as EventEnvelope;
}

/** Timeline and reduction order: server insertion order, the UUIDv7 id (ADR 0010). */
export const insertionOrder = { id: "asc" } as const satisfies Prisma.OrderEventOrderByWithRelationInput;

export interface ServerEventInput<T extends EventType> {
  type: T;
  payload: EventPayloadMap[T];
  orderId: string;
  actor: { userId: string; role: Role };
  at: Date;
}

/** A server-authored event: captured and received at the same server instant. */
export function appendServerEvent<T extends EventType>(
  tx: Prisma.TransactionClient,
  input: ServerEventInput<T>,
): Promise<OrderEventRow> {
  return tx.orderEvent.create({
    data: {
      type: input.type,
      schemaVersion: SCHEMA_VERSION,
      source: "SERVER",
      actorRole: input.actor.role,
      actorUserId: input.actor.userId,
      capturedAt: input.at,
      receivedAt: input.at,
      payload: input.payload as Prisma.InputJsonValue,
      orderId: input.orderId,
    },
  });
}
