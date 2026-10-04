# ADR 0051: Loader recording, Undo and plan review

- Status: proposed
- Date: 2026-10-04
- Issue / PR: #52
- Designathon departure: yes

## Context

L1–L3 require offline recording with a five-second Undo toast, per-row short/damaged quantities and a safe hand-over. The outbox may start sending immediately; deleting a queued fact cannot implement reliable Undo. Short and damaged quantities are incremental, while load confirmations contain per-line totals (ADRs 0042 and 0047).

## Decision

Save each checklist action as a user, depot, date, reset-epoch and plan-scoped Dexie draft for five seconds. Undo removes only this draft. After the window, atomically promote its events, evidence and durable receipt to the existing outbox/blob queue. Preserve the original capture time and clock offset. Resume expired drafts when that loader returns; another account cannot promote or cancel them. Reset removes these drafts and plan baselines. If the plan changes before promotion, retain the unsent draft and offer explicit discard during plan review; never relabel it with the new plan version.

Show one action set per order line within the reverse-stop checklist. A Short or Damaged report records the selected quantity and confirms the remaining unchecked units as loaded; the sheet states this before submission. Damage requires a photo; Short accepts one optionally. The shared `tripChecklistReadiness` controls completeness and dispatcher blockers. The UI rechecks the current projection before enqueuing `TRIP_READY`; the server remains authoritative. Local drafts finish their Undo window first. Durable load/ready receipts distinguish saved, held, failed, received-awaiting-snapshot and confirmed states after outbox pruning.

Plan review shows the current loading order, saves `PLAN_ACKNOWLEDGED`, and remains pending until acceptance and a covering snapshot. Do not invent an added/removed diff or a dispatcher-seen status from a version number or server receipt. Loader switching uses the existing authenticated PIN flow. The single-column phone layout follows ADR 0002.

The Loader snapshot has no vehicle display name, driver contact or vehicle capacities. Show the supplied trip identity, district, departure and measured loaded weight/volume, with capacity unavailable; never invent those missing values. English is complete. Sinhala/Tamil namespace leaves retain explicit draft English copy pending their separate tier-S translation task, as scoped in #52.

## Alternatives considered

- Delete pending outbox events for Undo: races sending and can erase an accepted fact.
- Send `LOAD_REVERSED`: changes server state and belongs to a separate tier-S workflow.
- Infer completeness from order status: violates the shared per-line gate and loses partial confirmations.
- Invent vehicle details or fetch them directly from the Loader screen: breaks truthful local-first reads.

## Consequences

The local Undo window delays enqueueing by five seconds and survives reload. App closure may defer promotion until the same loader returns. Confirmed facts remain immutable; dispatcher decisions and accepted snapshots determine their final state. Specs updated: frontend architecture and offline client. The README records these departures.
