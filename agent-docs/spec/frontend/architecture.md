---
status: draft
owner: Dinura
sources: guide §14, §14.1
---

# Frontend architecture

## 14.1 Shells and routes

One SPA. Route groups `/store/*`, `/dispatch/*`, `/loader/*`, `/driver/*`, plus `/login`. Route guards use `/auth/me`. Each role shell is a lazily loaded chunk; the **driver and loader chunks are precached** by the service worker, the others are runtime-cached. A shell sets `data-theme="store|dispatcher|loader|driver"` on its root.

Screen inventory (authoritative list and visuals are in the Figma file / design context): Store (home/deliveries, place order, order detail with timeline, confirm receipt and report issue, notifications); Dispatcher (order queue, plan board, deferral review, live run monitor, capacity outlook, fleet, exceptions inbox); Loader (trips by departure, loading checklist in reverse stop order, ready/hand-over with hold-to-confirm, connection and plan-changed states); Driver (today's run, stop detail, outcome and proof of delivery, sync/offline/reconnect/clash and plan-changed states, settings with sync diagnostics).
