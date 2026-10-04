# ADR 0048: Kandy reefer trucks in the workshop on the story day

- Status: proposed
- Date: 2026-10-04
- Issue / PR: #133
- Designathon departure: no

## Context

ADR 0008 and ADR 0027 pin the walkthrough's hill trip to `VEH039` and its driver `DRV039` (seed-and-demo.md §15.5). The seed fixes only the vehicle the picker validated the trip on. When the dispatcher proposes the Kandy plan on Tue 29 Sep 2026, `proposePlan` takes the first reefer truck that fits, and that is `VEH041`. `VEH039` stays idle and Sampath has no trip, so walkthrough steps 7 to 12 (§15.4) have nothing to run on. Probing showed that taking `VEH041` out only moves the trip to `VEH040`, and with both out it goes to `VEH043`.

## Decision

The seed puts the other four Kandy reefer trucks, `VEH040` to `VEH043`, in the workshop (`SERVICE`) on the story date. Each gets its `VEHICLE_AVAILABILITY_CHANGED` event, set by the dispatcher the morning before, the same way as the Peliyagoda workshop vehicles (`HILL_RUN_WORKSHOP` in `apps/api/prisma/seed/story.ts`). Proposing the Kandy plan then puts the hill trip (`OUT105 → OUT104 → OUT106 → OUT107`) on `VEH039`. A seed test and a publish integration test check it, and the integration test also checks that `DRV039`'s field snapshot shows the trip.

Kandy still serves all 8 story orders with no deferrals. It has 18 of 22 vehicles available, and 3 reefers: `VEH039` and the reefer vans `VEH057` and `VEH058`.

## Alternatives considered

- **Reach the trip only through the `plan-published` preset (#56).** The live Kandy proposal would still put the trip on the wrong vehicle, and a judge who proposes it on screen would lose the driver's trip.
- **Make `DRV041` the walkthrough driver.** This rewrites the ADR 0008, 0027 and 0030 picks, the spec and the README for no gain.
- **Make the allocator prefer the pinned vehicle.** That would put a story concern into `packages/rules`.

## Consequences

- The Kandy fleet view and capacity figures on the story day show four reefer trucks in the workshop.
- If a later allocator change moves the hill trip, the seed test and the integration test fail instead of the walkthrough breaking silently.
- seed-and-demo.md §15.5 gains a criterion naming the workshop vehicles (edited in this PR).
