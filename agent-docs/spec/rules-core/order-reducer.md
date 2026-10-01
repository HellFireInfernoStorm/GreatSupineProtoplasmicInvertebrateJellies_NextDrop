---
status: draft
owner: Dinura
sources: guide §5.5
---

# Order reducer and status rules

## 5.5 Order reducer and status rules

`applyEvent(state, event) -> state` is pure and shared by the API (authoritative) and the client (optimistic local projection: server snapshot + pending outbox).

- Transition table (allowed moves):
  `ORDERED -> PLANNED | DEFERRED | CANCELLED`; `DEFERRED -> PLANNED | CANCELLED`; `PLANNED -> LOADED | DEFERRED | PLANNED (re-plan)`; `LOADED -> OUT_FOR_DELIVERY`; `OUT_FOR_DELIVERY -> DELIVERED | FAILED`; `FAILED -> DEFERRED | PLANNED`; `DELIVERED -> RECEIVED | DISPUTED`; `DISPUTED -> RECEIVED`.
- **Monotonic progress rule**: rank `ORDERED < PLANNED < LOADED < OUT_FOR_DELIVERY < DELIVERED < RECEIVED`. A late-arriving fact for an earlier stage (e.g. a loader's offline `LOAD_CONFIRMED` arriving after the driver's `TRIP_DEPARTED`) is recorded on the timeline but does not regress status and is not a conflict.
- Timeline order is by effective time (`capturedAt + clockOffsetMs` for field events, `receivedAt` for server events). Reduction order is insertion order.
- `Short` and `Damaged` are flags on the order (with line detail), not statuses.
- `HELD` events (section 9.5) are skipped by the reducer until a `CONFLICT_RESOLVED` event accepts them.
