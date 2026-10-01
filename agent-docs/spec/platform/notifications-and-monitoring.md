---
status: draft
owner: Dinura
sources: guide §11
---

# Real-time, notifications, monitoring

- **Notifications**: rows in `Notification` with per-user read state (unread dot, all-read state). Created inside publish/ingest transactions. Delivery channels behind a `NotificationChannel` interface: in-app (feed + SSE), Web Push (MAY; VAPID; iOS requires installed PWA), SMS (stub that logs; used only if the build team wires a provider).
- **Who is notified**: store (deferral notice, ETA, delivered, dispute updates), loader and driver (plan changed, needs acknowledgement), dispatcher (short/damaged, problems, clashes, disputes, failed stops).
- **Live run monitor (D4)** is built on delivery events, not GPS. Per trip: stops done/total, `lastHeardAt`, `lastSyncAt`, `pendingCount`, late-risk, and a state label:
  `ON_TRACK`, `NO_SIGNAL` (no contact for `NO_SIGNAL_AFTER_MIN` while a run is active; shown grey with "last heard ..."), `BEHIND` (past ETA + grace), `ESCALATED` (no signal **and** behind schedule), `DONE`.
  `lastHeardAt` comes from `Device` heartbeats (`POST /sync/heartbeat`, sent when online) and from any accepted event.
- **Store view of a silent driver**: neutral "No signal, last heard 05:48" (not "late", not "lost"), with the delivered/confirmed double timestamp after sync.
- **Logging**: pino JSON with request ID; Driver/Loader settings include a sync diagnostics screen.
