---
status: draft
owner: Dinura
sources: guide §5, §5.1
---

# Rules core public surface

Pure, deterministic, no I/O, no `Date.now()`, no `Math.random()` (a seeded PRNG is allowed in local search). Runs in Node and in the browser.

## 5.1 Public surface

```ts
validatePlan(plan, ref, ctx): ValidationResult        // authoritative check of a whole plan
validateTrip(trip, ref, ctx): ValidationResult        // used for live edits
computeTripTime(trip, ref): TripTimeBreakdown         // outbound, inter-stop, handling, total
computeEtas(trip, ref, ctx): StopEta[]                // with windows and waiting
computeFuel(trip, vehicle, ref, cfg): { km, litres }
proposePlan(input, ref, cfg): AllocationResult        // trips, deferrals + explanations, stats, trace
rankOrders(orders, cfg, { date, calendar }): RankedOrder[]   // priority keys (slip needs the calendar)
explainDeferral(order, finalPlan, ref, cfg, ctx?): DeferralExplanation   // ctx: workshop and breakdown vehicles, fuel used, rank lookup
applyEvent(state, event): { state, outcome }         // order reducer (section 5.5, ADR 0019)
nextOperatingDate(date, calendar), operatingDateAfter(date, calendar), cutoffAt(date)   // calendar helpers
deliveryDateFor(requestedDate, placedAt, calendar)    // date an order targets after rollover and cutoff (ADR 0018)
orderingGuidance(brand, date, calendar): MessageKey | null   // brand ordering notice (ADR 0010)
```

`ValidationResult = { ok, violations: Violation[] }`, where `Violation = { code, severity: 'HARD'|'WARN', tripRef?, vehicleId?, orderIds[], params, message_key }`. `params` carries limit and actual values (e.g. `{ limit: 270, actual: 301 }`) so the UI can render the constraint-breach modal and localize it.
