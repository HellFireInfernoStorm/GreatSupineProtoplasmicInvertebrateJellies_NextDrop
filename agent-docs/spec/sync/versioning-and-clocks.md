---
status: draft
owner: Dinura
sources: guide §9.6
---

# Version skew and clocks

## 9.6 Version skew and clocks

- Events carry `schemaVersion`; `contracts` holds upcasters so old clients stay readable.
- The service worker updates only at a safe moment (idle, between stops), never mid-delivery.
- Client-side rule checks are advisory; the server re-validates.
- Device clocks are never used for ordering or conflict decisions. The client records `clockOffsetMs` (server minus device, learned from responses) so captured times can be shown accurately.
