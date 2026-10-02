---
status: draft
owner: Dinura
sources: guide §14, §14.1
---

# Frontend architecture

## 14.1 Shells and routes

One SPA. Route groups `/store/*`, `/dispatch/*`, `/loader/*`, `/driver/*`, plus `/login`. Route guards use `/auth/me`. Each role shell is a lazily loaded chunk; the **driver and loader chunks are precached** by the service worker, the others are runtime-cached. A shell sets `data-theme="store|dispatcher|loader|driver"` on its root.

Screen inventory (authoritative list and visuals are in the Figma file / design context): Store (home/deliveries, place order, order detail with timeline, confirm receipt and report issue, notifications); Dispatcher (order queue, plan board, deferral review, live run monitor, capacity outlook, fleet, exceptions inbox); Loader (trips by departure, loading checklist in reverse stop order, ready/hand-over with hold-to-confirm, connection and plan-changed states); Driver (today's run, stop detail, outcome and proof of delivery, sync/offline/reconnect/clash and plan-changed states, settings with sync diagnostics).

## 14.3 Conventions

- **Outlet grouping** (ADR 0010): accounting stays per order, but Driver and Store views group adjacent stops of one outlet and trip into one card with expandable order rows. A card is done when all its orders are confirmed. Trip time still counts service time per order.
- **Brand ordering guidance** (ADR 0010): the store order screen shows the notice from `orderingGuidance(brand, date, calendar)` (Style weekly day, Fresh chilled days, Tech single items). It is a notice only and never blocks submission. The seed obeys the same rule except on purpose.
- **Capacity in m³**: the capacity outlook and its axes use m³. Tonnes may appear as a secondary label.
