---
status: draft
owner: Dinura
sources: guide §5.5
---

# Order reducer and status rules

## 5.5 Order reducer and status rules

`applyEvent(state, event) -> state` is pure and shared by the API (authoritative) and the client (optimistic local projection: server snapshot + pending outbox).

- Transition table (allowed moves):
  `ORDERED -> PLANNED | DEFERRED | CANCELLED`; `DEFERRED -> PLANNED | CANCELLED`; `PLANNED -> LOADED | DEFERRED | PLANNED (re-plan)`; `LOADED -> OUT_FOR_DELIVERY`; `LOADED -> PLANNED | DEFERRED` only through `LOAD_REVERSED` (ADR 0004); `OUT_FOR_DELIVERY -> DELIVERED | FAILED`; `FAILED -> DEFERRED | PLANNED`; `DELIVERED -> RECEIVED | DISPUTED`; `DISPUTED -> RECEIVED`.
- **Monotonic progress rule**: rank `ORDERED < PLANNED < LOADED < OUT_FOR_DELIVERY < DELIVERED < RECEIVED`. A late-arriving fact for an earlier stage (e.g. a loader's offline `LOAD_CONFIRMED` arriving after the driver's `TRIP_DEPARTED`) is recorded on the timeline but does not regress status and is not a conflict.
- Timeline and reduction order are server insertion order (the event `id`, UUID v7), which keeps `deviceSeq` order within one device. `capturedAt` and `clockOffsetMs` are displayed beside each entry and never used to order (ADR 0010).
- `Short` and `Damaged` are flags on the order (with line detail), not statuses.
- `HELD` events (section 9.5) are skipped by the reducer until a `CONFLICT_RESOLVED` event accepts them.
