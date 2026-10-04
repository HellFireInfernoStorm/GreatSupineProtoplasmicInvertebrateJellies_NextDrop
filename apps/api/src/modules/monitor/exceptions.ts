import type { ApiDto } from "@nextdrop/contracts";
import { colomboInstant, colomboLocal, reduceOrder } from "@nextdrop/rules";
import type { PrismaClient } from "../../generated/prisma/client";
import { blobRefs } from "../blobs";
import { dateOnly, orderInclude, toOrderDto, toRulesEvent, type OrderRecord } from "../orders";

type Exception = ApiDto<"exception">;
type EventRow = OrderRecord["orderEvent_orderId"][number];

const unique = (ids: readonly string[]) => [...new Set(ids)];
/** The driver's proof of delivery for an order: every captured POD's photos and signature, held ones included. */
const podEvidence = (events: readonly EventRow[]) =>
  unique(events.filter((e) => e.type === "POD_CAPTURED").flatMap((e) => blobRefs(toRulesEvent(e).payload)));

/** An issue stays open until an `ISSUE_RESOLVED` follows it on the order (ISSUE_RESOLVED names no issue; ADR 0041). */
export function openIssues(events: readonly EventRow[]): EventRow[] {
  const lastResolved = [...events].reverse().find((e) => e.type === "ISSUE_RESOLVED")?.id ?? "";
  return events.filter((e) => e.type === "ISSUE_REPORTED" && e.id > lastResolved);
}

/**
 * `GET /dispatch/exceptions` (spec/planning/other-behaviours.md): everything the depot's dispatcher must act on, from
 * one list. Clashes, disputes and failed stops are listed until resolved, whatever their day. Shortfalls, damage,
 * problems and acknowledgements belong to today's run (Colombo date on the server clock).
 */
export async function listExceptions(prisma: PrismaClient, depot: string, now: Date): Promise<Exception[]> {
  const date = colomboLocal(now.getTime()).date;
  const today = dateOnly(date);
  const dayStart = new Date(colomboInstant(date, 0));
  const inDepot = { outlet: { depot } };

  const [conflicts, orders, problems, acks] = await Promise.all([
    prisma.conflict.findMany({
      where: { state: "OPEN", OR: [{ order: inDepot }, { trip: { planningDay: { depot } } }] },
      include: { heldEvent: true },
      orderBy: { openedAt: "asc" },
    }),
    // Orders with something open: an issue, a failure, or today's dock flags.
    prisma.order.findMany({
      where: {
        ...inDepot,
        OR: [
          { status: "FAILED" },
          { orderEvent_orderId: { some: { type: "ISSUE_REPORTED" } } },
          { currentDate: today, orderEvent_orderId: { some: { type: { in: ["LOAD_SHORT", "LOAD_DAMAGED"] } } } },
        ],
      },
      include: orderInclude,
      orderBy: { id: "asc" },
    }),
    prisma.orderEvent.findMany({
      where: {
        type: "PROBLEM_FLAGGED",
        receivedAt: { gte: dayStart },
        OR: [{ order: inDepot }, { trip: { planningDay: { depot } } }, { vehicle: { depot } }],
      },
      orderBy: { id: "asc" },
    }),
    prisma.orderEvent.findMany({
      where: { type: "PLAN_ACKNOWLEDGED", trip: { planningDay: { depot, date: today } } },
      orderBy: { id: "asc" },
    }),
  ]);

  const items: Exception[] = [];
  const pods = new Map(orders.map((o) => [o.id, podEvidence(o.orderEvent_orderId)]));
  for (const conflict of conflicts) {
    const orderPods = conflict.orderId
      ? (pods.get(conflict.orderId) ??
        podEvidence(await prisma.orderEvent.findMany({ where: { orderId: conflict.orderId, type: "POD_CAPTURED" } })))
      : [];
    items.push({
      type: "CONFLICT",
      conflict: {
        id: conflict.id,
        kind: conflict.kind as ApiDto<"conflict">["kind"],
        state: "OPEN",
        orderId: conflict.orderId,
        tripId: conflict.tripId,
        heldEventId: conflict.heldEventId,
        openedAt: conflict.openedAt.toISOString(),
        resolvedAt: null,
        resolution: null,
        note: conflict.note,
      },
      evidence: unique([...blobRefs(toRulesEvent(conflict.heldEvent).payload), ...orderPods]),
    });
  }

  for (const order of orders) {
    const events = order.orderEvent_orderId;
    for (const issue of openIssues(events)) {
      const payload = toRulesEvent(issue).payload as { kind: ApiDto<"issue">["kind"]; note?: string };
      items.push({
        type: "ISSUE",
        issue: {
          id: issue.id,
          orderId: order.id,
          kind: payload.kind,
          openedAt: issue.receivedAt.toISOString(),
          resolvedAt: null,
          note: payload.note ?? null,
        },
        // The store's photo beside the driver's proof of delivery.
        evidence: unique([...blobRefs(toRulesEvent(issue).payload), ...(pods.get(order.id) ?? [])]),
      });
    }
    if (order.currentDate.getTime() === today.getTime()) {
      const state = reduceOrder(order.id, events.map(toRulesEvent));
      for (const line of state.short) {
        if (line.resolution !== null && line.resolution !== "HOLD_TRIP") continue;
        items.push({
          type: "SHORT",
          orderId: order.id,
          lineId: line.lineId,
          qtyShort: line.qtyShort,
          resolution: line.resolution,
        });
      }
      const damagePhotos = unique(
        events.filter((e) => e.type === "LOAD_DAMAGED").flatMap((e) => blobRefs(toRulesEvent(e).payload)),
      );
      for (const line of state.damaged) {
        items.push({ type: "DAMAGED", orderId: order.id, lineId: line.lineId, qty: line.qty, evidence: damagePhotos });
      }
    }
    if (order.status === "FAILED") items.push({ type: "FAILED", order: toOrderDto(order) });
  }

  for (const problem of problems) {
    const payload = toRulesEvent(problem).payload as { kind: string; note?: string };
    items.push({
      type: "PROBLEM",
      eventId: problem.id,
      orderId: problem.orderId,
      tripId: problem.tripId,
      kind: payload.kind as Extract<Exception, { type: "PROBLEM" }>["kind"],
      note: payload.note ?? null,
      evidence: blobRefs(toRulesEvent(problem).payload),
    });
  }
  for (const ack of acks) {
    items.push({
      type: "ACK",
      tripId: ack.tripId!,
      planVersion: (toRulesEvent(ack).payload as { planVersion: number }).planVersion,
      actor: { userId: ack.actorUserId, role: ack.actorRole as Extract<Exception, { type: "ACK" }>["actor"]["role"] },
      at: ack.capturedAt.toISOString(),
    });
  }
  return items;
}
