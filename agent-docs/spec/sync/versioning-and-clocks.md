---
status: draft
owner: Dinura
sources: guide §9.6
---

# Version skew and clocks

## 9.6 Version skew and clocks

- Events carry `schemaVersion`; `contracts` holds upcasters so old clients stay readable. `SCHEMA_VERSION` is 2: `LOAD_DAMAGED` v1 payloads without `reasonCode` upcast to `OTHER` (ADR 0042). Other types have no payload change at v2.
- The service worker updates only at a safe moment (idle, between stops), never mid-delivery.
- Client-side rule checks are advisory; the server re-validates.
- Device clocks are never used for ordering or conflict decisions. The client records `clockOffsetMs` (server minus device, learned from responses) so captured times can be shown accurately.
- Timeline order is server insertion order; `deviceSeq` orders events within a device. Offsets are for display only (ADR 0010).
