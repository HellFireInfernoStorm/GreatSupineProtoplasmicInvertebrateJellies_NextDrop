import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { OrderEvent, OrderState, OrderStatus } from "./order-reducer";
import {
  applyEvent,
  emptyOrderState,
  isAllowedTransition,
  ordersGoingOut,
  PROGRESS_RANK,
  reduceOrder,
  TRANSITIONS,
  unresolvedShortLines,
} from "./order-reducer";

const ORDER = "ORD1";
let seq = 0;
const nextId = () => `ev-${String(++seq).padStart(6, "0")}`;

/** Builds an event for ORD1. */
function ev<T extends OrderEvent["type"]>(
  type: T,
  payload: Extract<OrderEvent, { type: T }>["payload"],
  extra: Partial<Pick<OrderEvent, "disposition" | "id">> & { tripId?: string } = {},
): OrderEvent {
  const { tripId, ...rest } = extra;
  return {
    id: nextId(),
    type,
    payload,
    subject: { orderId: ORDER, ...(tripId ? { tripId } : {}) },
    ...rest,
  } as OrderEvent;
}

const placed = () => ev("ORDER_PLACED", { requestedDate: "2026-10-05" });
const planned = (tripId = "T1", planVersion = 1) =>
  ev("ORDER_PLANNED", { tripId, vehicleId: "VEH001", seq: 0, planVersion });
const deferred = () => ev("ORDER_DEFERRED", { reasonCode: "TIME_BUDGET" });
const loaded = () => ev("LOAD_CONFIRMED", { lines: [] });
const departed = (tripId = "T1") => ev("TRIP_DEPARTED", { tripId }, { tripId });
const delivered = () => ev("STOP_OUTCOME", { outcome: "FULL" });

function run(...events: OrderEvent[]): OrderState {
  return reduceOrder(ORDER, events);
}

function statusAfter(...events: OrderEvent[]): OrderStatus | null {
  return run(...events).status;
}

describe("transition table (order-reducer.md, ADR 0004, ADR 0019)", () => {
  it("walks the happy path ORDERED -> PLANNED -> LOADED -> OUT_FOR_DELIVERY -> DELIVERED -> RECEIVED", () => {
    const events = [placed(), planned(), loaded(), departed(), delivered(), ev("RECEIPT_CONFIRMED", {})];
    let state = emptyOrderState(ORDER);
    const seen: (OrderStatus | null)[] = [];
    for (const e of events) {
      const r = applyEvent(state, e);
      expect(r.outcome.kind).toBe("APPLIED");
      state = r.state;
      seen.push(state.status);
    }
    expect(seen).toEqual(["ORDERED", "PLANNED", "LOADED", "OUT_FOR_DELIVERY", "DELIVERED", "RECEIVED"]);
  });

  it("allows each move in the table and only those", () => {
    expect(TRANSITIONS).toEqual({
      ORDERED: ["PLANNED", "DEFERRED", "CANCELLED"],
      DEFERRED: ["PLANNED", "CANCELLED"],
      PLANNED: ["LOADED", "DEFERRED", "PLANNED", "OUT_FOR_DELIVERY"],
      LOADED: ["OUT_FOR_DELIVERY", "PLANNED", "DEFERRED"],
      OUT_FOR_DELIVERY: ["DELIVERED", "FAILED"],
      FAILED: ["DEFERRED", "PLANNED"],
      DELIVERED: ["RECEIVED", "DISPUTED"],
      DISPUTED: ["RECEIVED"],
      RECEIVED: [],
      CANCELLED: [],
    });
  });

  it("cancels from ORDERED or DEFERRED, never once planned", () => {
    expect(statusAfter(placed(), ev("ORDER_CANCELLED", {}))).toBe("CANCELLED");
    expect(statusAfter(placed(), deferred(), ev("ORDER_CANCELLED", {}))).toBe("CANCELLED");
    const r = applyEvent(run(placed(), planned()), ev("ORDER_CANCELLED", {}));
    expect(r.outcome).toMatchObject({
      kind: "ILLEGAL_TRANSITION",
      from: "PLANNED",
      to: "CANCELLED",
      reason: "NOT_IN_TABLE",
    });
    expect(r.state.status).toBe("PLANNED");
  });

  it("re-plans a PLANNED order onto another trip", () => {
    const s = run(placed(), planned("T1", 1), planned("T2", 2));
    expect(s.status).toBe("PLANNED");
    expect(s.assignment).toMatchObject({ tripId: "T2", planVersion: 2 });
  });

  it("defers and re-plans, counting deferrals", () => {
    const s = run(placed(), deferred(), planned(), deferred());
    expect(s.status).toBe("DEFERRED");
    expect(s.deferralCount).toBe(2);
    expect(s.assignment).toBeNull();
  });

  it("moves FAILED back to PLANNED or DEFERRED", () => {
    const failed = [placed(), planned(), loaded(), departed(), ev("STOP_OUTCOME", { outcome: "FAILED" })];
    expect(statusAfter(...failed)).toBe("FAILED");
    expect(statusAfter(...failed, planned("T9", 2))).toBe("PLANNED");
    expect(statusAfter(...failed, deferred())).toBe("DEFERRED");
  });

  it("maps stop outcomes: FULL and PARTIAL deliver, REFUSED and FAILED fail", () => {
    const out = [placed(), planned(), loaded(), departed()];
    expect(statusAfter(...out, ev("STOP_OUTCOME", { outcome: "PARTIAL" }))).toBe("DELIVERED");
    expect(statusAfter(...out, ev("STOP_OUTCOME", { outcome: "REFUSED" }))).toBe("FAILED");
  });

  it("disputes a delivery and resolves the dispute to RECEIVED", () => {
    const d = [placed(), planned(), loaded(), departed(), delivered()];
    expect(statusAfter(...d, ev("ISSUE_REPORTED", { kind: "DAMAGED" }))).toBe("DISPUTED");
    expect(
      statusAfter(...d, ev("ISSUE_REPORTED", { kind: "SHORT" }), ev("ISSUE_RESOLVED", { resolution: "CREDIT" })),
    ).toBe("RECEIVED");
  });

  it("rejects any event before ORDER_PLACED", () => {
    const r = applyEvent(emptyOrderState(ORDER), planned());
    expect(r.outcome).toMatchObject({ kind: "ILLEGAL_TRANSITION", from: null, reason: "NOT_PLACED" });
  });

  it("rejects a jump the table does not allow, as a typed result", () => {
    const r = applyEvent(run(placed()), loaded());
    expect(r.outcome).toEqual({ kind: "ILLEGAL_TRANSITION", from: "ORDERED", to: "LOADED", reason: "NOT_IN_TABLE" });
    expect(r.state).toEqual(run(placed()));
  });
});

describe("loaded orders and reversals (ADR 0004)", () => {
  const onTruck = () => [placed(), planned("T1", 1), loaded()];

  it("never moves LOADED back without LOAD_REVERSED", () => {
    expect(isAllowedTransition("LOADED", "PLANNED", "ORDER_PLANNED")).toBe(false);
    expect(isAllowedTransition("LOADED", "DEFERRED", "ORDER_DEFERRED")).toBe(false);
    const r = applyEvent(run(...onTruck()), deferred());
    expect(r.outcome.kind).not.toBe("APPLIED");
    expect(r.state.status).toBe("LOADED");
  });

  it("rejects LOAD_REVERSED without a request", () => {
    const r = applyEvent(run(...onTruck()), ev("LOAD_REVERSED", {}));
    expect(r.outcome).toMatchObject({ kind: "ILLEGAL_TRANSITION", reason: "NO_REVERSAL_REQUESTED" });
  });

  it("rejects a reversal request for an order that is not loaded", () => {
    const r = applyEvent(run(placed(), planned()), ev("LOAD_REVERSAL_REQUESTED", { to: "DEFERRED", planVersion: 2 }));
    expect(r.outcome).toMatchObject({ kind: "ILLEGAL_TRANSITION", reason: "NOT_LOADED" });
  });

  it("keeps the order LOADED while the reversal is requested, then defers it when the loader confirms", () => {
    const requested = run(...onTruck(), ev("LOAD_REVERSAL_REQUESTED", { to: "DEFERRED", planVersion: 2 }));
    expect(requested.status).toBe("LOADED");
    const reversed = applyEvent(requested, ev("LOAD_REVERSED", {}));
    expect(reversed.outcome).toMatchObject({ kind: "APPLIED", from: "LOADED", to: "DEFERRED" });
    expect(reversed.state).toMatchObject({
      status: "DEFERRED",
      pendingReversal: null,
      assignment: null,
      deferralCount: 1,
    });
  });

  it("holds a new trip published during the reversal and applies it when the loader confirms", () => {
    const s0 = run(...onTruck(), ev("LOAD_REVERSAL_REQUESTED", { to: "PLANNED", planVersion: 2 }));
    const waiting = applyEvent(s0, planned("T7", 2));
    expect(waiting.outcome.kind).toBe("WAITING_FOR_REVERSAL");
    expect(waiting.state.status).toBe("LOADED");
    const s = applyEvent(waiting.state, ev("LOAD_REVERSED", {})).state;
    expect(s).toMatchObject({ status: "PLANNED", assignment: { tripId: "T7", planVersion: 2 } });
  });
});

describe("monotonic progress rule", () => {
  it("records a late LOAD_CONFIRMED after the trip departed without regressing status", () => {
    const s = run(placed(), planned("T1"), departed("T1"));
    expect(s.status).toBe("OUT_FOR_DELIVERY");
    const r = applyEvent(s, loaded());
    expect(r.outcome).toEqual({ kind: "IGNORED_EARLIER_STAGE", current: "OUT_FOR_DELIVERY", target: "LOADED" });
    expect(r.state).toEqual(s);
  });

  it("ignores a late out-for-delivery after the stop outcome, and after a failure", () => {
    const delivered1 = run(placed(), planned(), loaded(), departed(), delivered());
    expect(applyEvent(delivered1, departed()).outcome.kind).toBe("IGNORED_EARLIER_STAGE");
    const failed = run(placed(), planned(), loaded(), departed(), ev("STOP_OUTCOME", { outcome: "FAILED" }));
    expect(applyEvent(failed, loaded()).outcome.kind).toBe("IGNORED_EARLIER_STAGE");
  });

  it("treats a repeated fact for the current stage as earlier-stage", () => {
    const s = run(placed(), planned(), loaded());
    expect(applyEvent(s, loaded()).outcome).toEqual({
      kind: "IGNORED_EARLIER_STAGE",
      current: "LOADED",
      target: "LOADED",
    });
  });
});

describe("trip departure derives out for delivery (ADR 0019)", () => {
  it("takes PLANNED and LOADED orders of the departing trip out for delivery", () => {
    expect(statusAfter(placed(), planned("T1"), loaded(), departed("T1"))).toBe("OUT_FOR_DELIVERY");
    expect(statusAfter(placed(), planned("T1"), departed("T1"))).toBe("OUT_FOR_DELIVERY");
  });

  it("does nothing for another trip", () => {
    const r = applyEvent(run(placed(), planned("T1"), loaded()), departed("T2"));
    expect(r.outcome).toEqual({ kind: "NO_EFFECT", reason: "OTHER_TRIP" });
  });

  it("lists the orders a departure takes out", () => {
    const states = [
      {
        ...emptyOrderState("A"),
        status: "LOADED",
        assignment: { tripId: "T1", vehicleId: "V", seq: 0, planVersion: 1 },
      },
      {
        ...emptyOrderState("B"),
        status: "PLANNED",
        assignment: { tripId: "T1", vehicleId: "V", seq: 1, planVersion: 1 },
      },
      {
        ...emptyOrderState("C"),
        status: "LOADED",
        assignment: { tripId: "T2", vehicleId: "V", seq: 0, planVersion: 1 },
      },
      { ...emptyOrderState("D"), status: "DEFERRED", assignment: null },
    ] satisfies OrderState[];
    expect(ordersGoingOut("T1", states)).toEqual(["A", "B"]);
  });
});

describe("flags: short and damaged are not statuses", () => {
  it("records short and damaged lines and their resolution without changing status", () => {
    let s = run(placed(), planned());
    s = applyEvent(
      s,
      ev("LOAD_SHORT", {
        lines: [
          { lineId: "L1", qtyShort: 2 },
          { lineId: "L2", qtyShort: 1 },
        ],
      }),
    ).state;
    s = applyEvent(s, ev("LOAD_DAMAGED", { lines: [{ lineId: "L3", qty: 1 }] })).state;
    expect(s.status).toBe("PLANNED");
    expect(unresolvedShortLines(s).map((l) => l.lineId)).toEqual(["L1", "L2"]);
    s = applyEvent(s, ev("SHORT_RESOLVED", { lineId: "L1", outcome: "SHIP_PARTIAL" })).state;
    expect(unresolvedShortLines(s).map((l) => l.lineId)).toEqual(["L2"]);
    expect(s.damaged).toEqual([{ lineId: "L3", qty: 1 }]);
  });

  it("treats informational events as no-ops", () => {
    const s = run(placed(), planned());
    expect(applyEvent(s, ev("PLAN_ACKNOWLEDGED", { planVersion: 1 })).outcome).toEqual({
      kind: "NO_EFFECT",
      reason: "INFORMATIONAL",
    });
  });
});

describe("held events and conflicts", () => {
  const cancelledThenDelivered = () => {
    const fact = ev("STOP_OUTCOME", { outcome: "FULL" }, { disposition: "HELD" });
    return { fact, events: [placed(), planned("T1"), loaded(), departed("T1"), fact] };
  };

  it("skips a HELD event until the conflict is resolved", () => {
    const { fact, events } = cancelledThenDelivered();
    const s = run(...events);
    expect(s.status).toBe("OUT_FOR_DELIVERY");
    expect(Object.keys(s.held)).toEqual([fact.id]);
  });

  it("applies the held fact on ACCEPT_FACT", () => {
    const { fact, events } = cancelledThenDelivered();
    const s0 = run(
      ...events,
      ev("CONFLICT_OPENED", { conflictId: "C1", kind: "FACT_ON_REASSIGNED_STOP", heldEventId: fact.id }),
    );
    const r = applyEvent(s0, ev("CONFLICT_RESOLVED", { conflictId: "C1", resolution: "ACCEPT_FACT" }));
    expect(r.outcome).toMatchObject({
      kind: "RESOLVED",
      resolution: "ACCEPT_FACT",
      heldOutcome: { kind: "APPLIED", to: "DELIVERED" },
    });
    expect(r.state).toMatchObject({ status: "DELIVERED", held: {}, conflicts: {} });
  });

  it("leaves the held fact inert on REJECT_FACT", () => {
    const { fact, events } = cancelledThenDelivered();
    const s0 = run(
      ...events,
      ev("CONFLICT_OPENED", { conflictId: "C1", kind: "FACT_ON_REASSIGNED_STOP", heldEventId: fact.id }),
    );
    const s = applyEvent(s0, ev("CONFLICT_RESOLVED", { conflictId: "C1", resolution: "REJECT_FACT" })).state;
    expect(s).toMatchObject({ status: "OUT_FOR_DELIVERY", held: {}, rejectedEventIds: [fact.id] });
  });

  it("applies an accepted fact on a cancelled stop although the table has no move from CANCELLED", () => {
    const fact = ev("STOP_OUTCOME", { outcome: "FULL" }, { disposition: "HELD" });
    const s0 = run(placed(), ev("ORDER_CANCELLED", {}), fact);
    expect(s0.status).toBe("CANCELLED");
    const r = applyEvent(
      s0,
      ev("CONFLICT_RESOLVED", { conflictId: "C9", resolution: "ACCEPT_FACT", heldEventId: fact.id }),
    );
    expect(r.outcome).toMatchObject({
      heldOutcome: { kind: "APPLIED", from: "CANCELLED", to: "DELIVERED", forced: true },
    });
  });

  it("does not let an accepted fact regress status", () => {
    const fact = loaded();
    const heldFact = { ...fact, disposition: "HELD" } as OrderEvent;
    const s0 = run(placed(), planned("T1"), heldFact, departed("T1"));
    const r = applyEvent(
      s0,
      ev("CONFLICT_RESOLVED", { conflictId: "C2", resolution: "ACCEPT_FACT", heldEventId: fact.id }),
    );
    expect(r.outcome).toMatchObject({ heldOutcome: { kind: "IGNORED_EARLIER_STAGE" } });
    expect(r.state.status).toBe("OUT_FOR_DELIVERY");
  });

  it("reports an unknown conflict as no effect", () => {
    const r = applyEvent(run(placed()), ev("CONFLICT_RESOLVED", { conflictId: "nope", resolution: "ACCEPT_FACT" }));
    expect(r.outcome).toEqual({ kind: "NO_EFFECT", reason: "UNKNOWN_HELD_EVENT" });
  });
});

// ---- Properties -----------------------------------------------------------------------------------------------------

/** Events that are legal from a status, for a random walk through the table. */
function legalNext(state: OrderState): OrderEvent[] {
  const trip = state.assignment?.tripId ?? "T1";
  switch (state.status) {
    case null:
      return [placed()];
    case "ORDERED":
    case "DEFERRED":
      return [planned("T1"), planned("T2"), deferred(), ev("ORDER_CANCELLED", {})].filter(
        (e) => state.status === "ORDERED" || e.type !== "ORDER_DEFERRED",
      );
    case "PLANNED":
      return [
        loaded(),
        planned("T2", 2),
        deferred(),
        departed(trip),
        ev("LOAD_SHORT", { lines: [{ lineId: "L1", qtyShort: 1 }] }),
      ];
    case "LOADED":
      return state.pendingReversal
        ? [ev("LOAD_REVERSED", {}), planned("T3", 3)]
        : [
            departed(trip),
            ev("LOAD_REVERSAL_REQUESTED", { to: "DEFERRED", planVersion: 2 }),
            ev("LOAD_REVERSAL_REQUESTED", { to: "PLANNED", planVersion: 2 }),
          ];
    case "OUT_FOR_DELIVERY":
      return [delivered(), ev("STOP_OUTCOME", { outcome: "FAILED" }), ev("STOP_ARRIVED", {})];
    case "FAILED":
      return [planned("T4", 4), deferred()];
    case "DELIVERED":
      return [ev("RECEIPT_CONFIRMED", {}), ev("ISSUE_REPORTED", { kind: "SHORT" })];
    case "DISPUTED":
      return [ev("ISSUE_RESOLVED", { resolution: "CREDIT" })];
    case "RECEIVED":
    case "CANCELLED":
      return [];
  }
}

/** A legal event sequence, built by a random walk with choices drawn from fast-check. */
const legalSequence = fc.array(fc.nat(), { maxLength: 25 }).map((choices) => {
  const events: OrderEvent[] = [];
  let state = emptyOrderState(ORDER);
  for (const c of [0, ...choices]) {
    const options = legalNext(state);
    if (!options.length) break;
    const e = options[c % options.length] as OrderEvent;
    events.push(e);
    state = applyEvent(state, e).state;
  }
  return events;
});

const anyEvent: fc.Arbitrary<OrderEvent> = fc
  .tuple(
    fc.constantFrom(
      placed,
      () => planned("T1"),
      () => planned("T2", 2),
      deferred,
      loaded,
      () => departed("T1"),
      delivered,
      () => ev("STOP_OUTCOME", { outcome: "FAILED" }),
      () => ev("ORDER_CANCELLED", {}),
      () => ev("LOAD_REVERSAL_REQUESTED", { to: "PLANNED", planVersion: 2 }),
      () => ev("LOAD_REVERSED", {}),
      () => ev("RECEIPT_CONFIRMED", {}),
      () => ev("ISSUE_REPORTED", { kind: "OTHER" }),
      () => ev("ISSUE_RESOLVED", {}),
      () => ev("CONFLICT_RESOLVED", { conflictId: "C", resolution: "ACCEPT_FACT" }),
    ),
    fc.boolean(),
  )
  .map(([make, held]) => {
    const e = make();
    return held ? ({ ...e, disposition: "HELD" } as OrderEvent) : e;
  });

describe("properties", () => {
  it("every step of a legal sequence is applied", () => {
    fc.assert(
      fc.property(legalSequence, (events) => {
        let state = emptyOrderState(ORDER);
        for (const e of events) {
          const r = applyEvent(state, e);
          if (
            r.outcome.kind !== "APPLIED" &&
            r.outcome.kind !== "NO_EFFECT" &&
            r.outcome.kind !== "WAITING_FOR_REVERSAL"
          ) {
            return false;
          }
          state = r.state;
        }
        return true;
      }),
    );
  });

  it("replaying from a snapshot equals incremental reduction, for any split point", () => {
    fc.assert(
      fc.property(legalSequence, fc.nat(), (events, k) => {
        const split = events.length ? k % (events.length + 1) : 0;
        const snapshot = reduceOrder(ORDER, events.slice(0, split));
        expect(reduceOrder(ORDER, events.slice(split), snapshot)).toEqual(reduceOrder(ORDER, events));
      }),
    );
  });

  it("never throws and never regresses along the ladder except through the table's backward moves", () => {
    fc.assert(
      fc.property(fc.array(anyEvent, { maxLength: 30 }), (events) => {
        let state = emptyOrderState(ORDER);
        for (const e of events) {
          const r = applyEvent(state, e);
          const before = state.status;
          const after = r.state.status;
          if (
            r.outcome.kind === "ILLEGAL_TRANSITION" ||
            r.outcome.kind === "IGNORED_EARLIER_STAGE" ||
            r.outcome.kind === "SKIPPED_HELD"
          ) {
            expect(after).toBe(before);
          }
          if (r.outcome.kind === "APPLIED" && before !== null && after !== null && before !== after) {
            const back =
              (PROGRESS_RANK[after] ?? Infinity) < (PROGRESS_RANK[before] ?? -Infinity) &&
              !(r.outcome.forced || TRANSITIONS[before].includes(after));
            expect(back).toBe(false);
          }
          state = r.state;
        }
      }),
    );
  });
});
