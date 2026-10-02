---
status: draft
owner: Dinura
sources: guide §14, §14.1
---

# Frontend architecture

## 14.1 Shells and routes

One SPA. Route groups `/store/*`, `/dispatch/*`, `/loader/*`, `/driver/*`, plus `/login`. Route guards use `/auth/me`. Each role shell is a lazily loaded chunk; the **driver and loader chunks are precached** by the service worker, the others are runtime-cached. A shell sets `data-theme="store|dispatcher|loader|driver"` on its root.

Screen inventory. The authoritative list and visuals are the live Figma file (ADR 0015), summarised in `design/screens.md`.

- **Store:** sign-in; my deliveries; place order with the outlet brand's product catalogue; review and submit; order placed; deferral notice; order tracking, timeline, history and detail; confirm receipt; report issue; notifications; the "late or lost?" sheet.
- **Dispatcher:** sign-in with depot; dashboard (D0); order queue (D1); plan board (D2) with the add-trip modal in valid and blocked states; defer and publish (D3); Delivery Progress (D4, the live run monitor, route `/dispatch/runs`, with exceptions inbox and evidence detail); capacity outlook (D5); fleet and capacity; notifications popover; confirmation toasts.
- **Loader:** PIN sign-in with language chips; trips by departure; loading checklist in reverse stop order; short and damaged sheets; ready and hand-over with hold-to-confirm; connection and plan-changed states.
- **Driver:** PIN sign-in; today's run; stop detail; flag a problem; outcome and proof of delivery; sync, offline, reconnect, clash and plan-changed states; settings with sync diagnostics.

## 14.3 Conventions

- **Outlet grouping** (ADR 0010): accounting stays per order, but Driver and Store views group adjacent stops of one outlet and trip into one card with expandable order rows. A card is done when all its orders are confirmed. Trip time still counts service time per order.
- **Brand ordering guidance** (ADR 0010): the store order screen shows the notice from `orderingGuidance(brand, date, calendar)` (Style weekly day, Fresh chilled days, Tech single items). It is a notice only and never blocks submission. The seed obeys the same rule except on purpose.
- **Capacity in m³**: the capacity outlook and its axes use m³. Tonnes may appear as a secondary label.
