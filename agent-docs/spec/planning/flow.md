---
status: draft
owner: Dinura
sources: guide §8, §8.1
---

# Planning flow

## 8.1 Flow

1. At cutoff, the `tick` job moves the planning day `OPEN -> CLOSED` and notifies the dispatcher.
2. Dispatcher opens the **queue** (confirmed orders with flags: chilled, van only, mall window, dock type, skipped yesterday; demand vs capacity summary).
3. **Propose**: `POST .../propose` runs `proposePlan` (or the solver, if enabled) and stores the result as the `PlanDraft`.
4. **Edit**: the dispatcher reassigns orders, adds a trip (vehicle + trip no), or moves orders to "unassigned". The UI runs `validateTrip`/`validatePlan` locally on every edit. A hard violation blocks the action with the violation's reason and disables the create/confirm button. The draft is saved with `revision` for optimistic concurrency; the server re-validates on save.
5. **Defer review**: every unassigned order needs a reason code (pre-filled from the allocator's explanation, editable, `OTHER` needs a note). Outlets skipped last run are pinned at the top.
6. **Publish** (atomic, below). Publishing notifies the loader, driver and store managers.

Manual-only planning is also valid: the dispatcher can start from an empty draft and the same validator guards every move.
