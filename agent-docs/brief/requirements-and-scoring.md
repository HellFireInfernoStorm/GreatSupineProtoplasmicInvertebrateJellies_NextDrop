---
status: draft
owner: Dinura
sources: guide §1.2-1.3
---

# Booklet requirements and scoring map

## 1.2 Booklet requirements that shape the architecture

- Responsive web app; **judges assess driver and loader on phone-sized screens**. Native apps are optional extras.
- Plans respect capacity, temperature, outlet access, delivery windows, fuel quotas. Automatic, assisted or manual-with-validation planning is allowed; the system MUST produce constraint-respecting allocations and identify deferred orders with recorded reasons.
- Must handle a day when demand exceeds capacity.
- Work away from the depot MUST function offline and reconcile on reconnect.
- `docker compose up` at repo root starts everything including DB, migrations and seed data. `.env.example` at root.
- Public deployed URL (kept live through finals), four seeded accounts (one per role), README with setup, accounts, numbered judge walkthrough across all four roles, and departures from the Designathon design.
- `docs/` folder: architecture diagram, data model, AI tool disclosure (separate from this guide).
- Demo video 5-8 minutes.
- Orders close at 16:00 (Asia/Colombo) for the next day. Late orders wait for the following run. A Fresh outlet may have two orders (dry + chilled) for one day, so the allocation key is always `order`, never `outlet`.

## 1.3 Scoring to architecture

| Hackathon criterion (weight) | Architectural response |
| --- | --- |
| Functional completeness, four roles (20%) | Role shells over one order lifecycle; seeded story day; Playwright walkthrough test |
| Planning and allocation engine (20%) | Pure shared rules core, explainable heuristic allocator, deferral records, fuel ledger, optional solver |
| Degradation, offline, recovery (10%) | Outbox, idempotent ingest, plan-version clash detection, visible sync state |
| Fidelity to Day 5 design (10%) | Design tokens per role from Figma variables, component kit mirroring Figma component sets |
| Engineering quality and architecture (25%) | Module boundaries enforced in CI, contracts package, property-based and replay tests, docs |
| Creativity (5%) | Deferral "unavoidable vs choice" explanations, live rule checks, solver quality readout (optional) |
| Demo video (10%) | Demo clock, reset, presets, force-offline switch make the walkthrough repeatable |
