---
status: draft
owner: Dinura
sources: guide §8, §8.1
---

# Planning flow

## 8.1 Flow

1. At cutoff, the `tick` job moves the planning day `OPEN -> CLOSED` (`ordersClosedAt` = the cutoff) and notifies the depot's dispatchers (`orders_closed`). The tick also creates the OPEN planning day for the date orders currently target (ADR 0033).
2. Dispatcher opens the **queue** (confirmed orders with flags: chilled, van only, mall window, dock type, skipped yesterday; demand vs capacity summary). The queue is the depot's orders for the date in a plannable status (ORDERED, PLANNED, DEFERRED, FAILED, LOADED). Demand vs capacity is the `proposePlan` stats for that queue and the available fleet (ADR 0036).
3. **Propose**: `POST .../propose` runs `proposePlan` (or the solver, if enabled) and stores the result as the `PlanDraft`.
4. **Edit**: the dispatcher reassigns orders, adds a trip (vehicle + trip no), or moves orders to "unassigned". The UI runs `validateTrip`/`validatePlan` locally on every edit. A hard violation blocks the action with the violation's reason and disables the create/confirm button. The draft is saved with `revision` for optimistic concurrency; the server re-validates on save and refuses a draft with a HARD violation (422 with the `ValidationResult`; warnings save). Drafts can be written once orders are closed (CLOSED, PLANNING, PUBLISHED, IN_PROGRESS); the first write moves CLOSED to PLANNING (ADR 0036).
5. **Defer review**: every unassigned order needs a reason code (pre-filled from the allocator's explanation, editable, `OTHER` needs a note). Outlets skipped last run are pinned at the top.
6. **Publish** (atomic, below). Publishing notifies the loader, driver and store managers.

Manual-only planning is also valid: the dispatcher can start from an empty draft and the same validator guards every move.

The scoped day response includes `planningContext` from the server day-input loader: per-vehicle weekly fuel used on other published, non-cancelled days (excluding the selected day), queued-outlet service age and previous-run deferral state, and queued LOADED-order vehicle/trip-number pins with pending reversal state. The UI passes this context into both shared validators, displays weekly fuel and service age, and still calls server validation before each save. The context may change after it is fetched; it never replaces revision checks or server revalidation.

Planning reads also retain current published-trip orders beyond the allocatable queue. planningContext.publishedStops lists their orderId, vehicleId, tripNo, 1-based seq, locked and departed flags. Locked stops show a lock label and cannot move; unreported departed stops can move to the end of their own trip or to Unassigned for D3 review. New cargo and cross-trip moves on departed trips are refused. Propose is refused after departure; edit the retained draft instead (ADR 0053).

