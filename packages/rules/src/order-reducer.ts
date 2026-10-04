// The order reducer: the one pure function that derives order status from the event stream (spec/rules-core/order-reducer.md).
// The API runs it authoritatively; the offline client runs it over the server snapshot plus its pending outbox.
// It never throws on an event: an illegal move comes back as a typed outcome so sync can classify it.

export const ORDER_STATUSES = [
  "ORDERED",
  "PLANNED",
  "DEFERRED",
  "CANCELLED",
  "LOADED",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "FAILED",
  "RECEIVED",
  "DISPUTED",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Progress ladder for the monotonic rule: ORDERED < PLANNED < LOADED < OUT_FOR_DELIVERY < DELIVERED < RECEIVED. */
export const PROGRESS_RANK: Readonly<Partial<Record<OrderStatus, number>>> = {
  ORDERED: 0,
  PLANNED: 1,
  LOADED: 2,
  OUT_FOR_DELIVERY: 3,
  DELIVERED: 4,
  RECEIVED: 5,
};

/** Where a status off the ladder sits on it, for deciding whether a fact is from an earlier stage. CANCELLED has none. */
const EFFECTIVE_RANK: Readonly<Partial<Record<OrderStatus, number>>> = {
  ...PROGRESS_RANK,
  DEFERRED: 0,
  FAILED: 3,
  DISPUTED: 4,
};

/**
 * Allowed moves. Two are restricted to one kind of event:
 * - LOADED -> PLANNED | DEFERRED only through `LOAD_REVERSED` (ADR 0004).
 * - PLANNED -> OUT_FOR_DELIVERY only through the trip's departure (ADR 0019).
 */
export const TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
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
};

const DEPARTURE_EVENTS: readonly string[] = ["TRIP_DEPARTED", "ORDER_OUT_FOR_DELIVERY"];

/** Whether `event` may move an order from `from` to `to` under the transition table. */
export function isAllowedTransition(from: OrderStatus | null, to: OrderStatus, eventType: OrderEvent["type"]): boolean {
  if (from === null) return to === "ORDERED" && eventType === "ORDER_PLACED";
  if (!TRANSITIONS[from].includes(to)) return false;
  if (from === "LOADED" && (to === "PLANNED" || to === "DEFERRED")) return eventType === "LOAD_REVERSED";
  if (from === "PLANNED" && to === "OUT_FOR_DELIVERY") return DEPARTURE_EVENTS.includes(eventType);
  return true;
}

// ---- Events ---------------------------------------------------------------------------------------------------------
// Structural types for the fields the reducer reads. The zod envelope and catalogue live in packages/contracts, which
// may import these types; packages/rules imports nothing.

export type Disposition = "APPLIED" | "HELD";

interface EventOf<T extends string, P> {
  /** Server-assigned UUID v7; reduction order is insertion order. */
  readonly id: string;
  readonly type: T;
  /** Set at insert. HELD events are skipped until a dispatcher accepts them. Defaults to APPLIED. */
  readonly disposition?: Disposition;
  readonly subject: { readonly orderId?: string; readonly tripId?: string };
  readonly payload: P;
}

export interface ShortLine {
  readonly lineId: string;
  readonly qtyShort: number;
}
export interface DamagedLine {
  readonly lineId: string;
  readonly qty: number;
}
export interface LoadedLine {
  readonly lineId: string;
  readonly qtyLoaded: number;
}
export const SHORT_OUTCOMES = ["SHIP_PARTIAL", "HOLD_TRIP", "BACKORDER"] as const;
export type ShortOutcome = (typeof SHORT_OUTCOMES)[number];
export const STOP_OUTCOMES = ["FULL", "PARTIAL", "REFUSED", "FAILED"] as const;
export type StopOutcome = (typeof STOP_OUTCOMES)[number];
export const CONFLICT_RESOLUTIONS = ["ACCEPT_FACT", "REJECT_FACT"] as const;
export type ConflictResolution = (typeof CONFLICT_RESOLUTIONS)[number];
export const REVERSAL_TARGETS = ["PLANNED", "DEFERRED"] as const;
export type ReversalTarget = (typeof REVERSAL_TARGETS)[number];

export type OrderEvent =
  | EventOf<"ORDER_PLACED", { readonly requestedDate?: string; readonly replacesOrderId?: string }>
  | EventOf<"ORDER_CANCELLED", { readonly reason?: string }>
  | EventOf<
      "ORDER_PLANNED",
      { readonly tripId: string; readonly vehicleId: string; readonly seq?: number; readonly planVersion: number }
    >
  | EventOf<"ORDER_DEFERRED", { readonly reasonCode: string; readonly toDate?: string; readonly planVersion?: number }>
  | EventOf<"LOAD_SHORT", { readonly lines: readonly ShortLine[]; readonly reasonCode?: string }>
  | EventOf<"LOAD_DAMAGED", { readonly lines: readonly DamagedLine[]; readonly reasonCode?: string }>
  | EventOf<"LOAD_CONFIRMED", { readonly lines?: readonly { lineId: string; qtyLoaded: number }[] }>
  | EventOf<"SHORT_RESOLVED", { readonly lineId: string; readonly outcome: ShortOutcome; readonly note?: string }>
  | EventOf<"LOAD_REVERSAL_REQUESTED", { readonly to: ReversalTarget; readonly planVersion: number }>
  | EventOf<"LOAD_REVERSED", { readonly lines?: readonly unknown[] }>
  | EventOf<"TRIP_DEPARTED", { readonly tripId?: string }>
  | EventOf<"ORDER_OUT_FOR_DELIVERY", { readonly tripId?: string }>
  | EventOf<"STOP_OUTCOME", { readonly outcome: StopOutcome; readonly reasonCode?: string }>
  | EventOf<"RECEIPT_CONFIRMED", Readonly<Record<string, unknown>>>
  | EventOf<"ISSUE_REPORTED", { readonly kind: string }>
  | EventOf<"ISSUE_RESOLVED", { readonly resolution?: string }>
  | EventOf<"CONFLICT_OPENED", { readonly conflictId: string; readonly kind: string; readonly heldEventId: string }>
  | EventOf<
      "CONFLICT_RESOLVED",
      { readonly conflictId: string; readonly resolution: ConflictResolution; readonly heldEventId?: string }
    >
  | InformationalEvent<(typeof INFORMATIONAL_EVENT_TYPES)[number]>;

/** Events on an order's timeline that never change its state. */
export const INFORMATIONAL_EVENT_TYPES = [
  "PLAN_CHANGED",
  "PLAN_ACKNOWLEDGED",
  "TRIP_READY",
  "STOP_ARRIVED",
  "POD_CAPTURED",
  "PROBLEM_FLAGGED",
  "VEHICLE_AVAILABILITY_CHANGED",
] as const;
type InformationalEvent<T extends string> = T extends string ? EventOf<T, Readonly<Record<string, unknown>>> : never;

export type OrderEventType = OrderEvent["type"];

// ---- State ----------------------------------------------------------------------------------------------------------

export interface PendingReversal {
  readonly to: ReversalTarget;
  readonly planVersion: number;
  /** The plan decision for this order published while it was still on the truck; applied when the loader confirms. */
  readonly next: Assignment | { readonly deferred: true } | null;
}

export interface Assignment {
  readonly tripId: string;
  readonly vehicleId: string;
  readonly seq: number | null;
  readonly planVersion: number;
}

/** Plain, serializable state: it is stored in Postgres and in Dexie. */
export interface OrderState {
  readonly orderId: string;
  /** null until `ORDER_PLACED`. */
  readonly status: OrderStatus | null;
  readonly assignment: Assignment | null;
  /** Number of times the order has been deferred. */
  readonly deferralCount: number;
  /** Short and Damaged are flags with line detail, not statuses. */
  readonly short: readonly (ShortLine & { readonly resolution: ShortOutcome | null })[];
  readonly damaged: readonly DamagedLine[];
  /** Per-line loaded quantities from `LOAD_CONFIRMED` (ADR 0047). Cleared on `LOAD_REVERSED`. */
  readonly loaded: readonly LoadedLine[];
  readonly lastStopOutcome: StopOutcome | null;
  readonly pendingReversal: PendingReversal | null;
  /** HELD events waiting for a dispatcher decision, by event id. */
  readonly held: Readonly<Record<string, OrderEvent>>;
  /** Open conflicts: conflict id -> held event id. */
  readonly conflicts: Readonly<Record<string, string>>;
  /** Held events the dispatcher rejected: recorded, never applied. */
  readonly rejectedEventIds: readonly string[];
}

export function emptyOrderState(orderId: string): OrderState {
  return {
    orderId,
    status: null,
    assignment: null,
    deferralCount: 0,
    short: [],
    damaged: [],
    loaded: [],
    lastStopOutcome: null,
    pendingReversal: null,
    held: {},
    conflicts: {},
    rejectedEventIds: [],
  };
}

// ---- Outcomes -------------------------------------------------------------------------------------------------------

export type ReduceOutcome =
  /** The event was applied: status moved, or its record (flags, assignment, conflict) was updated. */
  | {
      readonly kind: "APPLIED";
      readonly from: OrderStatus | null;
      readonly to: OrderStatus | null;
      readonly forced: boolean;
    }
  /** A fact for an earlier (or the same) stage than the order has reached: recorded on the timeline, status kept. */
  | { readonly kind: "IGNORED_EARLIER_STAGE"; readonly current: OrderStatus; readonly target: OrderStatus }
  /** Not allowed by the transition table. State is unchanged. */
  | {
      readonly kind: "ILLEGAL_TRANSITION";
      readonly from: OrderStatus | null;
      readonly to: OrderStatus | null;
      readonly reason: "NOT_IN_TABLE" | "NOT_PLACED" | "NO_REVERSAL_REQUESTED" | "NOT_LOADED";
    }
  /** A HELD event: kept aside until `CONFLICT_RESOLVED`. */
  | { readonly kind: "SKIPPED_HELD" }
  /** A plan decision for a LOADED order with a reversal pending: kept until `LOAD_REVERSED`. */
  | { readonly kind: "WAITING_FOR_REVERSAL" }
  /** A dispatcher decision on a held event, with what applying it did. */
  | { readonly kind: "RESOLVED"; readonly resolution: ConflictResolution; readonly heldOutcome: ReduceOutcome | null }
  /** Nothing to change for this order (another trip's departure, an informational event, an unknown conflict). */
  | { readonly kind: "NO_EFFECT"; readonly reason: "INFORMATIONAL" | "OTHER_TRIP" | "UNKNOWN_HELD_EVENT" };

export interface ReduceResult {
  readonly state: OrderState;
  readonly outcome: ReduceOutcome;
}

// ---- Reducer --------------------------------------------------------------------------------------------------------

/** The status an event moves the order to, or null for events that do not set a status. */
function targetOf(state: OrderState, event: OrderEvent): OrderStatus | null {
  switch (event.type) {
    case "ORDER_PLACED":
      return "ORDERED";
    case "ORDER_CANCELLED":
      return "CANCELLED";
    case "ORDER_PLANNED":
      return "PLANNED";
    case "ORDER_DEFERRED":
      return "DEFERRED";
    case "LOAD_CONFIRMED":
      return "LOADED";
    case "LOAD_REVERSED":
      return state.pendingReversal ? reversalTarget(state.pendingReversal) : null;
    case "TRIP_DEPARTED":
    case "ORDER_OUT_FOR_DELIVERY":
      return "OUT_FOR_DELIVERY";
    case "STOP_OUTCOME":
      return event.payload.outcome === "FULL" || event.payload.outcome === "PARTIAL" ? "DELIVERED" : "FAILED";
    case "RECEIPT_CONFIRMED":
    case "ISSUE_RESOLVED":
      return "RECEIVED";
    case "ISSUE_REPORTED":
      return "DISPUTED";
    default:
      return null;
  }
}

function reversalTarget(r: PendingReversal): ReversalTarget {
  if (r.next === null) return r.to;
  return "deferred" in r.next ? "DEFERRED" : "PLANNED";
}

function departingTrip(event: OrderEvent): string | undefined {
  if (event.type !== "TRIP_DEPARTED" && event.type !== "ORDER_OUT_FOR_DELIVERY") return undefined;
  return event.payload.tripId ?? event.subject.tripId;
}

/** Applies one event. Pure; never throws for a well-formed event. */
export function applyEvent(state: OrderState, event: OrderEvent): ReduceResult {
  if ((event.disposition ?? "APPLIED") === "HELD") {
    return { state: { ...state, held: { ...state.held, [event.id]: event } }, outcome: { kind: "SKIPPED_HELD" } };
  }
  if (event.type === "CONFLICT_OPENED") {
    const { conflictId, heldEventId } = event.payload;
    return applied(state, { ...state, conflicts: { ...state.conflicts, [conflictId]: heldEventId } });
  }
  if (event.type === "CONFLICT_RESOLVED") return resolveConflict(state, event);
  return reduce(state, event, false);
}

function resolveConflict(state: OrderState, event: Extract<OrderEvent, { type: "CONFLICT_RESOLVED" }>): ReduceResult {
  const { conflictId, resolution } = event.payload;
  const heldId = event.payload.heldEventId ?? state.conflicts[conflictId];
  const held = heldId === undefined ? undefined : state.held[heldId];
  if (heldId === undefined || held === undefined) {
    return { state, outcome: { kind: "NO_EFFECT", reason: "UNKNOWN_HELD_EVENT" } };
  }
  const { [heldId]: _removed, ...stillHeld } = state.held;
  const { [conflictId]: _closed, ...stillOpen } = state.conflicts;
  const base: OrderState = { ...state, held: stillHeld, conflicts: stillOpen };
  if (resolution === "REJECT_FACT") {
    return {
      state: { ...base, rejectedEventIds: [...state.rejectedEventIds, heldId] },
      outcome: { kind: "RESOLVED", resolution, heldOutcome: null },
    };
  }
  const inner = reduce(base, held, true);
  return { state: inner.state, outcome: { kind: "RESOLVED", resolution, heldOutcome: inner.outcome } };
}

/**
 * Core step. `forced` is true when the dispatcher accepted a held fact: the fact happened, so it applies even where the
 * transition table has no move for it, but it still never regresses status (ADR 0019).
 */
function reduce(state: OrderState, event: OrderEvent, forced: boolean): ReduceResult {
  const from = state.status;

  if (event.type === "TRIP_DEPARTED" || event.type === "ORDER_OUT_FOR_DELIVERY") {
    const trip = departingTrip(event);
    if (trip !== undefined && state.assignment?.tripId !== trip) {
      return { state, outcome: { kind: "NO_EFFECT", reason: "OTHER_TRIP" } };
    }
  }

  // A plan decision published while the order is still on the truck with a reversal pending waits for the loader.
  if (
    from === "LOADED" &&
    state.pendingReversal &&
    (event.type === "ORDER_PLANNED" || event.type === "ORDER_DEFERRED")
  ) {
    const next = event.type === "ORDER_PLANNED" ? assignmentOf(event) : ({ deferred: true } as const);
    return {
      state: { ...state, pendingReversal: { ...state.pendingReversal, next } },
      outcome: { kind: "WAITING_FOR_REVERSAL" },
    };
  }

  if (event.type === "LOAD_REVERSAL_REQUESTED") {
    if (from !== "LOADED") return illegal(state, from, null, "NOT_LOADED");
    const { to, planVersion } = event.payload;
    return applied(state, { ...state, pendingReversal: { to, planVersion, next: null } });
  }
  if (event.type === "LOAD_REVERSED" && !state.pendingReversal) {
    return illegal(state, from, null, "NO_REVERSAL_REQUESTED");
  }

  const target = targetOf(state, event);
  if (target === null) {
    const recorded = recordOnly(state, event);
    return recorded ? applied(state, recorded) : { state, outcome: { kind: "NO_EFFECT", reason: "INFORMATIONAL" } };
  }

  if (from === null) {
    if (isAllowedTransition(from, target, event.type)) return applied(state, withStatus(state, event, target), forced);
    return illegal(state, from, target, "NOT_PLACED");
  }

  if (isAllowedTransition(from, target, event.type)) return applied(state, withStatus(state, event, target), forced);

  // Monotonic progress: a late fact for an earlier or the same stage is recorded but never regresses status.
  const targetRank = PROGRESS_RANK[target];
  const currentRank = EFFECTIVE_RANK[from];
  if ((targetRank !== undefined && currentRank !== undefined && targetRank <= currentRank) || target === from) {
    // Still project LOAD_CONFIRMED quantities when status does not move (ADR 0047).
    if (event.type === "LOAD_CONFIRMED") {
      return {
        state: { ...state, loaded: mergeLoaded(state.loaded, event.payload.lines ?? []) },
        outcome: { kind: "IGNORED_EARLIER_STAGE", current: from, target },
      };
    }
    return { state, outcome: { kind: "IGNORED_EARLIER_STAGE", current: from, target } };
  }

  if (forced) return applied(state, withStatus(state, event, target), true);
  return illegal(state, from, target, "NOT_IN_TABLE");
}

function assignmentOf(event: Extract<OrderEvent, { type: "ORDER_PLANNED" }>): Assignment {
  const { tripId, vehicleId, seq, planVersion } = event.payload;
  return { tripId, vehicleId, seq: seq ?? null, planVersion };
}

/** Latest qtyLoaded per lineId; later confirmations replace earlier ones for the same line. */
function mergeLoaded(
  prev: readonly LoadedLine[],
  updates: readonly { lineId: string; qtyLoaded: number }[],
): readonly LoadedLine[] {
  const map = new Map(prev.map((l) => [l.lineId, l.qtyLoaded]));
  for (const u of updates) map.set(u.lineId, u.qtyLoaded);
  return [...map.entries()].map(([lineId, qtyLoaded]) => ({ lineId, qtyLoaded }));
}

/** State after moving to `target`, with the event's own record. */
function withStatus(state: OrderState, event: OrderEvent, target: OrderStatus): OrderState {
  const next: OrderState = { ...state, status: target };
  switch (event.type) {
    case "ORDER_PLANNED":
      return { ...next, assignment: assignmentOf(event) };
    case "ORDER_DEFERRED":
      return { ...next, assignment: null, deferralCount: state.deferralCount + 1 };
    case "LOAD_CONFIRMED":
      return { ...next, loaded: mergeLoaded(state.loaded, event.payload.lines ?? []) };
    case "LOAD_REVERSED": {
      const r = state.pendingReversal;
      // Clear dock projections: the unload starts a new checklist cycle (ADR 0047). Timeline events stay.
      const afterReversal: OrderState = {
        ...next,
        pendingReversal: null,
        loaded: [],
        short: [],
        damaged: [],
      };
      if (target === "DEFERRED") return { ...afterReversal, assignment: null, deferralCount: state.deferralCount + 1 };
      return { ...afterReversal, assignment: r?.next && !("deferred" in r.next) ? r.next : null };
    }
    case "STOP_OUTCOME":
      return { ...next, lastStopOutcome: event.payload.outcome };
    default:
      return next;
  }
}

/** Record for events that set no status, or null when the event changes nothing on the order. */
function recordOnly(state: OrderState, event: OrderEvent): OrderState | null {
  switch (event.type) {
    case "LOAD_SHORT":
      return { ...state, short: [...state.short, ...event.payload.lines.map((l) => ({ ...l, resolution: null }))] };
    case "LOAD_DAMAGED":
      return { ...state, damaged: [...state.damaged, ...event.payload.lines] };
    case "SHORT_RESOLVED": {
      const { lineId, outcome } = event.payload;
      return { ...state, short: state.short.map((l) => (l.lineId === lineId ? { ...l, resolution: outcome } : l)) };
    }
    default:
      return null;
  }
}

function applied(prev: OrderState, state: OrderState, forced = false): ReduceResult {
  return { state, outcome: { kind: "APPLIED", from: prev.status, to: state.status, forced } };
}

function illegal(
  state: OrderState,
  from: OrderStatus | null,
  to: OrderStatus | null,
  reason: Extract<ReduceOutcome, { kind: "ILLEGAL_TRANSITION" }>["reason"],
): ReduceResult {
  return { state, outcome: { kind: "ILLEGAL_TRANSITION", from, to, reason } };
}

/** Folds events in server insertion order. Start from a stored snapshot to replay only what came after it. */
export function reduceOrder(orderId: string, events: readonly OrderEvent[], from?: OrderState): OrderState {
  let state = from ?? emptyOrderState(orderId);
  for (const event of events) state = applyEvent(state, event).state;
  return state;
}

/** Short lines still waiting for `SHORT_RESOLVED`. `TRIP_READY` requires none on any order of the trip (ADR 0005). */
export function unresolvedShortLines(state: OrderState): readonly ShortLine[] {
  return state.short.filter((l) => l.resolution === null);
}

/**
 * Short lines that keep a trip from `TRIP_READY`: unresolved, or resolved `HOLD_TRIP` (ADR 0005, event catalogue).
 * A trip may be marked ready only when no order on it has any.
 */
export function shortLinesBlockingReady(
  state: OrderState,
): readonly (ShortLine & { readonly resolution: ShortOutcome | null })[] {
  return state.short.filter((l) => l.resolution === null || l.resolution === "HOLD_TRIP");
}

/** One ordered line the loader must account for on the checklist (ADR 0047). */
export interface ChecklistLineInput {
  readonly lineId: string;
  readonly qtyOrdered: number;
  /**
   * Authoritative loaded quantity when known (OrderLine.qtyLoaded / Dexie projection).
   * When omitted, uses the reducer's `state.loaded` for that line (0 if never confirmed).
   */
  readonly qtyLoaded?: number;
}

/** One order on a trip, with its ordered lines and reduced dock state. */
export interface OrderChecklistInput {
  readonly orderId: string;
  readonly lines: readonly ChecklistLineInput[];
  readonly state: OrderState;
}

export interface IncompleteChecklistLine {
  readonly orderId: string;
  readonly lineId: string;
  readonly qtyOrdered: number;
  readonly qtyAccounted: number;
  readonly missing: number;
}

export interface BlockingShortLine {
  readonly orderId: string;
  readonly line: ShortLine & { readonly resolution: ShortOutcome | null };
}

/**
 * Loader checklist readiness for a trip (ADR 0047).
 * A line is checked when `qtyLoaded + ΣqtyShort + ΣqtyDamaged >= qtyOrdered`.
 * Status `LOADED` alone is not enough: one `LOAD_CONFIRMED` line cannot cover a multi-line order.
 * Dispatcher blockers reuse `shortLinesBlockingReady` (unresolved / `HOLD_TRIP`).
 */
export interface TripChecklistReadiness {
  readonly ready: boolean;
  readonly incompleteLines: readonly IncompleteChecklistLine[];
  readonly blockingShorts: readonly BlockingShortLine[];
}

function sumByLine(rows: readonly { readonly lineId: string; readonly qty: number }[], lineId: string): number {
  let total = 0;
  for (const row of rows) if (row.lineId === lineId) total += row.qty;
  return total;
}

function loadedQty(state: OrderState, lineId: string, override?: number): number {
  if (override !== undefined) return override;
  return state.loaded.find((l) => l.lineId === lineId)?.qtyLoaded ?? 0;
}

/** Readiness for one order: incomplete lines and short blockers. */
export function orderChecklistReadiness(
  orderId: string,
  lines: readonly ChecklistLineInput[],
  state: OrderState,
): Pick<TripChecklistReadiness, "incompleteLines" | "blockingShorts"> {
  const incompleteLines: IncompleteChecklistLine[] = [];
  for (const line of lines) {
    const qtyLoaded = loadedQty(state, line.lineId, line.qtyLoaded);
    const qtyShort = sumByLine(
      state.short.map((l) => ({ lineId: l.lineId, qty: l.qtyShort })),
      line.lineId,
    );
    const qtyDamaged = sumByLine(state.damaged, line.lineId);
    const qtyAccounted = qtyLoaded + qtyShort + qtyDamaged;
    if (qtyAccounted < line.qtyOrdered) {
      incompleteLines.push({
        orderId,
        lineId: line.lineId,
        qtyOrdered: line.qtyOrdered,
        qtyAccounted,
        missing: line.qtyOrdered - qtyAccounted,
      });
    }
  }
  const blockingShorts = shortLinesBlockingReady(state).map((line) => ({
    orderId,
    line,
  }));
  return { incompleteLines, blockingShorts };
}

/**
 * Trip-level gate consumed by API `TRIP_READY` and the Loader UI (#52).
 * `ready` is true only when every line is checked and no short blocks departure.
 */
export function tripChecklistReadiness(orders: readonly OrderChecklistInput[]): TripChecklistReadiness {
  const incompleteLines: IncompleteChecklistLine[] = [];
  const blockingShorts: BlockingShortLine[] = [];
  for (const order of orders) {
    const part = orderChecklistReadiness(order.orderId, order.lines, order.state);
    incompleteLines.push(...part.incompleteLines);
    blockingShorts.push(...part.blockingShorts);
  }
  return {
    ready: incompleteLines.length === 0 && blockingShorts.length === 0,
    incompleteLines,
    blockingShorts,
  };
}

/**
 * Orders a `TRIP_DEPARTED` takes out for delivery: those assigned to the trip that are PLANNED or LOADED (ADR 0019).
 * The server derives one `ORDER_OUT_FOR_DELIVERY` per order returned.
 */
export function ordersGoingOut(tripId: string, states: Iterable<OrderState>): string[] {
  const out: string[] = [];
  for (const s of states) {
    if (s.assignment?.tripId === tripId && (s.status === "PLANNED" || s.status === "LOADED")) out.push(s.orderId);
  }
  return out;
}
