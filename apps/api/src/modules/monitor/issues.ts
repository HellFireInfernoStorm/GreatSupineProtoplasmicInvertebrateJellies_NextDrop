import type { ApiDtoInput } from "@nextdrop/contracts";
import {
  applyEvent,
  colomboLocal,
  emptyOrderState,
  operatingDateAfter,
  reduceOrder,
  type OrderEvent,
} from "@nextdrop/rules";
import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import { ApiHttpError, notFound } from "../../lib/errors";
import { appendFeed, type FeedRowInput } from "../feed";
import type { Notifier } from "../notifications";
import {
  appendServerEvent,
  insertOrder,
  orderChanged,
  orderInclude,
  toRulesEvent,
  type CalendarSource,
  type NewOrder,
  type OrderRecord,
} from "../orders";

type Resolution = ApiDtoInput<"resolveIssueRequest">;
const TX = { maxWait: 5_000, timeout: 10_000 } as const;

export const addToRunKey = (issueId: string) => `add-to-run:${issueId}`;

export interface IssueDependencies {
  prisma: PrismaClient;
  now: () => Date;
  calendar: CalendarSource;
  notifier: Notifier;
}

/** The quantities ADD_TO_RUN sends again: the issue's lines, else whatever the store did not receive. */
function followUpLines(order: OrderRecord, issuePayload: unknown): NewOrder["lines"] {
  const reported = (issuePayload as { lines?: { lineId: string; qty?: number }[] }).lines ?? [];
  const wanted = reported.length
    ? reported.map((l) => {
        const line = order.orderLine_orderId.find((x) => x.id === l.lineId);
        return { line, qty: l.qty ?? line?.qtyOrdered ?? 0 };
      })
    : order.orderLine_orderId.map((line) => ({ line, qty: line.qtyOrdered - line.qtyReceived }));
  return wanted
    .filter((w): w is { line: OrderRecord["orderLine_orderId"][number]; qty: number } => !!w.line && w.qty > 0)
    .map(({ line, qty }) => ({
      productId: line.productId,
      sku: line.product.sku,
      qtyOrdered: qty,
      unitWeightKg: line.unitWeightKg,
      unitVolumeM3: line.unitVolumeM3,
    }));
}

/**
 * `POST /dispatch/issues/:id/resolve` (catalogue: ISSUE_RESOLVED, ADR 0041). The id is the ISSUE_REPORTED event id.
 * The decision closes the order's open dispute; ADD_TO_RUN places a follow-up order on the next operating day.
 */
export function createIssues(deps: IssueDependencies) {
  const { prisma, notifier } = deps;

  async function resolveOnce(actor: { userId: string }, issueId: string, body: Resolution) {
    const issue = await prisma.orderEvent.findUnique({ where: { id: issueId } });
    if (!issue || issue.type !== "ISSUE_REPORTED" || !issue.orderId) throw notFound();
    const order = await prisma.order.findUniqueOrThrow({ where: { id: issue.orderId }, include: orderInclude });
    const events = order.orderEvent_orderId;
    const decided = events.find((e) => e.type === "ISSUE_RESOLVED" && e.id > issue.id);
    if (decided) {
      // Retrying the same decision is a no-op; changing a decision is not allowed.
      const previous = (toRulesEvent(decided).payload as { resolution: string }).resolution;
      if (previous === body.resolution) return;
      throw new ApiHttpError(409, "ILLEGAL_TRANSITION", "issues.alreadyResolved", { resolution: previous });
    }

    const payload = { resolution: body.resolution, ...(body.note === undefined ? {} : { note: body.note }) };
    const next = applyEvent(reduceOrder(order.id, events.map(toRulesEvent)), {
      id: "pending",
      type: "ISSUE_RESOLVED",
      subject: { orderId: order.id },
      payload,
    } as OrderEvent);
    if (next.outcome.kind === "ILLEGAL_TRANSITION") {
      throw new ApiHttpError(409, "ILLEGAL_TRANSITION", "errors.illegal_transition", { from: order.status });
    }
    const status = next.state.status ?? order.status;
    const now = deps.now();
    let followUp: NewOrder | null = null;
    if (body.resolution === "ADD_TO_RUN") {
      const lines = followUpLines(order, toRulesEvent(issue).payload);
      if (lines.length === 0) throw new ApiHttpError(409, "ILLEGAL_TRANSITION", "issues.nothingToAdd");
      const date = operatingDateAfter(colomboLocal(now.getTime()).date, await deps.calendar.get());
      const placed = applyEvent(emptyOrderState("pending"), {
        id: "pending",
        type: "ORDER_PLACED",
        subject: {},
        payload: { requestedDate: date, replacesOrderId: order.id },
      } as OrderEvent).state.status!;
      followUp = {
        outletId: order.outletId,
        depot: order.outlet.depot,
        brand: order.brand,
        tempRequirement: order.tempRequirement,
        requestedDate: date,
        currentDate: date,
        status: placed,
        placedAt: now,
        idempotencyKey: addToRunKey(issue.id),
        replacesOrderId: order.id,
        lines,
        actor: { userId: actor.userId, role: "DISPATCHER" },
      };
    }

    await prisma.$transaction(async (tx) => {
      const { count } = await tx.order.updateMany({ where: { id: order.id, status: order.status }, data: { status } });
      if (count === 0) throw new ApiHttpError(409, "ILLEGAL_TRANSITION", "orders.changedConcurrently");
      await appendServerEvent(tx, {
        type: "ISSUE_RESOLVED",
        payload,
        orderId: order.id,
        actor: { userId: actor.userId, role: "DISPATCHER" },
        at: now,
      });
      const feed: FeedRowInput[] = [
        orderChanged({
          id: order.id,
          outletId: order.outletId,
          depot: order.outlet.depot,
          vehicleId: order.tripStop_orderId[0]?.trip.vehicleId ?? null,
        }),
      ];
      const params: Record<string, string> = { order: order.displayId, resolution: body.resolution };
      if (followUp) {
        // The store cutoff does not apply: the server places this order for the dispatcher.
        const placed = await insertOrder(tx, followUp);
        feed.push(placed.feed);
        params.followUp = placed.displayId;
      }
      feed.push(
        ...(await notifier.notify(tx, {
          kind: "dispute_updated",
          audience: { role: "STORE", outletId: order.outletId },
          params,
          entity: { type: "issue", id: issue.id },
        })),
      );
      await appendFeed(tx, feed);
    }, TX);
  }

  return {
    async resolve(actor: { userId: string }, issueId: string, body: Resolution) {
      try {
        await resolveOnce(actor, issueId, body);
      } catch (error) {
        // A concurrent identical ADD_TO_RUN committed first (the follow-up key is unique): answer as a retry.
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
        await resolveOnce(actor, issueId, body);
      }
      return { ok: true as const, serverTime: deps.now().toISOString() };
    },
  };
}

export type Issues = ReturnType<typeof createIssues>;
