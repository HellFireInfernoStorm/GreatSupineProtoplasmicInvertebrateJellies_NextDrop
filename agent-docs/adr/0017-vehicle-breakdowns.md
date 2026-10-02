# ADR 0017: Vehicle breakdowns

- Status: accepted
- Date: 2026-10-02
- Issue / PR: owner decision (Dinura), see the PR that adds this file
- Designathon departure: no

## Context

The Figma file includes vehicle breakdowns in four places:

- The dispatcher Notifications rationale (`514:19238`) lists "vehicle breakdowns" among the actionable notifications.
- The driver's "Flag a problem" sheet (`382:444`) offers the reason "Vehicle problem".
- Fleet & capacity shows "In Workshop · Unavailable today".
- D5 warns of "little slack for a breakdown".

The owner ruled that features in the Figma design must be built. The spec had workshop availability (`VehicleAvailability`, `VEHICLE_UNAVAILABLE`) but no breakdown event, no notification and no rule for trips already planned on a vehicle that breaks down.

## Decision

1. **Driver report.** `PROBLEM_FLAGGED.kind` takes the reasons drawn on the sheet: `STORE_NOT_OPEN`, `ROAD_BLOCKED`, `DOCK_UNREACHABLE`, `VEHICLE_PROBLEM`, `RUNNING_LATE`. `VEHICLE_PROBLEM` creates a "Needs action" dispatcher notification and an inbox item linking to the vehicle on Fleet & capacity.
2. **Breakdown record.** The dispatcher marks a vehicle broken down, from that inbox item or from Fleet & capacity. This emits `VEHICLE_AVAILABILITY_CHANGED` with `{ vehicleId, date, status IN_WORKSHOP, reason BREAKDOWN, note, sourceEventId? }` and sets `VehicleAvailability` for that date. Returning a vehicle to service uses the same event with `status AVAILABLE`. Scheduled workshop days use `reason SERVICE`.
3. **Notification.** A breakdown notifies the dispatcher ("Needs action": vehicle, affected trips, link to the plan board). It also notifies the drivers and loaders of the affected trips.
4. **Trips not yet departed** on that vehicle and date fail `VEHICLE_UNAVAILABLE` in the current plan. The dispatcher moves their orders with a normal republish. `LOADED` orders follow ADR 0004 (reversal requested, then confirmed at the dock).
5. **A departed trip.** Visited stops keep their facts. The driver records each remaining stop as `STOP_OUTCOME FAILED` with `reasonCode VEHICLE_BREAKDOWN`. Failed orders return to planning through the existing `FAILED -> PLANNED | DEFERRED` transitions. A deferral caused by a breakdown uses the reason code `VEHICLE_BREAKDOWN`.
6. **Allocator.** Unchanged: vehicles `IN_WORKSHOP` for the date are excluded, whatever the reason.

## Alternatives considered

- Notification only, no plan effect: the published plan would keep a vehicle that cannot run.
- Automatic re-planning on breakdown: breaks "the system proposes, the dispatcher decides" and can move loaded goods silently.

## Consequences

- One new event, one enum on an existing event, two new reason codes, and new `VehicleAvailability` fields (`reason`, `note`, `setBy`, `setAt`).
- Spec edited: `events/catalogue.md`, `planning/other-behaviours.md`, `data/model.md`, `platform/notifications-and-monitoring.md`, `rules-core/deferral-explanation.md`.
