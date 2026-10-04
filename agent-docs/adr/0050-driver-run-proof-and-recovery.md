# ADR 0050: Driver run, proof and recovery

- Status: proposed
- Date: 2026-10-04
- Issue / PR: #53 / #130
- Designathon departure: yes

## Context

The Driver implementation needs concrete routes, outcome/proof requirements and recovery gates. The event catalogue defines payloads but does not settle the minimum proof, partial-delivery constraints or how held facts affect the plan-change sheet. Live Figma R1/R2/R3 supplies the visual flow; ADRs 0008 and 0010 already replace invented fixture IDs and group adjacent outlet stops without combining their accounting.

## Decision

Use `/driver` for the run, `/driver/stop/:stopId` for each order's arrival/outcome/proof, `/driver/sync` for recovery and `/driver/settings` for language and diagnostics. Read Dexie snapshots and write intent events through the outbox. Adjacent outlet orders share a physical-stop card but retain separate outcomes, proof and receipts. Every order in that card must have a locally saved projected outcome/proof or an authoritative terminal status before the card is done. DELIVERED, RECEIVED, FAILED, DISPUTED and CANCELLED prevent another driver recording; held or rejected facts alone do not complete an order.

Keep quantity and proof rules in the pure `packages/rules.validateStopOutcome` function, returning stable reason codes. FULL delivers loaded quantities; PARTIAL uses safe integer quantities between zero and loaded, with at least one delivered and one returned item across the order. REFUSED and FAILED deliver zero and return loaded quantities. Every outcome requires a receiver name and signature or photo; every non-full outcome additionally requires a reason and photo. Persist outcome, proof and receipt atomically before displaying Saved. These requirements govern the Driver save gate; API adoption of the validator is a separate change, without changing the current event contract.

All synced means records and proof reached the server, not that dispatch accepted held facts. Keep those facts inert and marked Needs dispatch, with original/current plan context and evidence preserved after snapshot replacement. Show changed-plan review only after queued work, accepted-event covering snapshots and held-fact context reconcile. Open clashes with received context may remain visible during plan review. PLAN_ACKNOWLEDGED is durable and counts as acknowledged only after server acceptance and a covering snapshot; a held/rejected acknowledgement cannot dismiss the review permanently.

Beyond ADRs 0008 and 0010, departures are explicit separate navigation to each order within an outlet group, a settings page for language/diagnostics, and real queue/error/context gates instead of the prototype's timed recovery transition. The app retains received-but-held Needs dispatch evidence beside All synced. These states expose real persistence and server decisions instead of fabricating confirmation or dispatcher actions; the core R1/R2/R3 layouts follow live Figma. The minimum proof policy settles unspecified behavior rather than adding a new service or event type.

## Alternatives considered

- Literal UI status lists and duplicated quantity/proof checks: miss RECEIVED and violate the single rules implementation boundary.
- One outcome for a grouped outlet: loses independent order accounting.
- A fixed reconnect timer or pending-zero acceptance: may hide a held fact or lose proof.
- Block all plan review until dispatch resolves every clash: prevents the driver acknowledging the current plan despite successful receipt of their previous work.

## Consequences

The same PR updates frontend architecture, the event catalogue, offline-client recovery semantics and the rules public surface. README records the departures. No new API, event schema, migration or dependency is required. Native review of Sinhala/Tamil draft copy remains necessary. This ADR remains proposed until owner review.
