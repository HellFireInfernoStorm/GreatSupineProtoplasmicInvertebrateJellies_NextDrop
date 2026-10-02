# ADR 0010: Presentation and ordering conventions

- Status: accepted
- Date: 2026-10-02
- Issue / PR: owner decision (Dinura), see the PR that adds this file
- Designathon departure: yes (label `designathon-departure`)

## Context

Five small questions: duplicate stops at one door, brand ordering rhythms, capacity unit, timeline order, and deferral consequences. None is large alone; recording them together keeps the spec consistent.

## Decision

1. **Deferral consequences.** `DeferralExplanation` and the `Deferral` row gain `nextServiceableDate`, `daysUnserved` and `consecutiveDeferrals`, computed in `packages/rules`.
2. **Outlet grouping.** Accounting stays per order. Driver and store views group adjacent stops of one outlet and trip into one card; a card is done when all its orders are.
3. **Brand ordering rules.** `orderingGuidance(brand, date, calendar)` in `packages/rules` returns a message key or none. The store order screen shows it as a notice and never blocks submission.
4. **Capacity unit.** Capacity and forecasts are in m³, stored as litres. Tonnes may appear as a secondary label. This departs from the design's tonnes.
5. **Timeline order.** Order is server insertion order (event `id`, UUID v7), which keeps `deviceSeq` order within a device. Captured time and clock offset are shown, never used to order.

## Alternatives considered

- Per-order stops in the driver view: duplicate stops at one shop.
- Blocking brand rules: risky when demand rules are only partly specified.
- Tonnes as the primary unit: wrong binding constraint for most loads.

## Consequences

The capacity screens and driver stop list in the design change (departure). Spec edited: `rules-core/deferral-explanation.md`, `data/model.md`, `events/catalogue.md`, `frontend/architecture.md`, `rules-core/api-surface.md`, `domain/units-and-time.md`, `rules-core/order-reducer.md`, `sync/versioning-and-clocks.md`.
