---
status: draft
owner: Dinura
sources: guide §7.2
---

# Event catalogue

## 7.2 Catalogue

| Type | Source / author | Key payload | Effect |
| --- | --- | --- | --- |
| `ORDER_PLACED` | Server / store or dispatcher | lines, requestedDate, replacesOrderId? | -> ORDERED |
| `ORDER_CANCELLED` | Server / store or dispatcher | reason | -> CANCELLED (before loading) |
| `ORDER_PLANNED` | Server / publish | tripId, vehicleId, seq, etaFrom, etaTo, planVersion | -> PLANNED |
| `PLAN_CHANGED` | Server / publish | from, to, planVersion | stays PLANNED; notifies |
| `ORDER_DEFERRED` | Server / publish or system | reasonCode, causeKind, scoreInputs, toDate (= nextServiceableDate), daysUnserved, consecutiveDeferrals, note, decidedBy | -> DEFERRED |
| `PLAN_ACKNOWLEDGED` | Field / loader, driver | planVersion | none |
| `LOAD_SHORT` | Field / loader | lines[{lineId, qtyShort}], reasonCode, photoRef? | flag; notifies dispatcher + store |
| `LOAD_DAMAGED` | Field / loader | lines[{lineId, qty}], reasonCode (`CRUSHED`, `LEAKING`, `TORN_PACKAGING`, `CONTAMINATED`, `OTHER`; ADR 0042), photoRef? | flag; notifies dispatcher |
| `LOAD_CONFIRMED` | Field / loader | lines[{lineId, qtyLoaded}] | -> LOADED |
| `SHORT_RESOLVED` | Server / dispatcher | orderId, lineId, outcome SHIP_PARTIAL, HOLD_TRIP, BACKORDER; note | resolves a `LOAD_SHORT` line; BACKORDER creates a follow-up order via `ORDER_PLACED` with `replacesOrderId` |
| `LOAD_REVERSAL_REQUESTED` | Server / dispatcher | orderId, to PLANNED or DEFERRED, planVersion | loader task; order stays LOADED |
| `LOAD_REVERSED` | Field / loader | orderId, lines | LOADED -> PLANNED or DEFERRED |
| `TRIP_READY` | Field / loader (hold-to-confirm) | tripId | trip -> READY (requires every checklist line checked and every `LOAD_SHORT` line resolved other than `HOLD_TRIP`; ADRs 0005, 0026, 0047) |
| `TRIP_DEPARTED` | Field / driver | tripId | trip -> DEPARTED; server derives `ORDER_OUT_FOR_DELIVERY` per PLANNED or LOADED order on the trip (ADR 0019) |
| `ORDER_OUT_FOR_DELIVERY` | Server / derived from `TRIP_DEPARTED` | tripId? | -> OUT_FOR_DELIVERY (ADR 0019) |
| `STOP_ARRIVED` | Field / driver | orderId | none (progress + last heard) |
| `STOP_OUTCOME` | Field / driver | outcome FULL, PARTIAL, REFUSED, FAILED; lines delivered/returned; reasonCode? (`VEHICLE_BREAKDOWN` for stops left after a breakdown, ADR 0017) | -> DELIVERED (FULL, PARTIAL) or FAILED |
| `POD_CAPTURED` | Field / driver | receiverName, signatureBlobRef?, photoBlobRefs[] | evidence attached |
| `PROBLEM_FLAGGED` | Field / driver | kind STORE_NOT_OPEN, ROAD_BLOCKED, DOCK_UNREACHABLE, VEHICLE_PROBLEM, RUNNING_LATE; note, photoRef? | dispatcher inbox; `VEHICLE_PROBLEM` also notifies the dispatcher as needs action (ADR 0017) |
| `RECEIPT_CONFIRMED` | Server / store | lines received | -> RECEIVED |
| `ISSUE_REPORTED` | Server / store | kind SHORT, DAMAGED, WARM, OTHER; lines; photo; note | -> DISPUTED; dispatcher inbox |
| `ISSUE_RESOLVED` | Server / dispatcher | CREDIT, ADD_TO_RUN, REJECT; note | -> RECEIVED; ADD_TO_RUN creates a follow-up order |
| `VEHICLE_AVAILABILITY_CHANGED` | Server / dispatcher | vehicleId, date, status AVAILABLE or IN_WORKSHOP, reason SERVICE or BREAKDOWN, note, sourceEventId? | sets `VehicleAvailability`; a breakdown notifies the dispatcher and the affected trips' loaders and drivers (ADR 0017) |
| `CONFLICT_OPENED` | Server | conflictId, kind, heldEventId | dispatcher inbox |
| `CONFLICT_RESOLVED` | Server / dispatcher | conflictId, ACCEPT_FACT or REJECT_FACT, note | reducer applies or drops the held event |

Trip-level facts are stored once (subject `tripId`), vehicle-level facts once (subject `vehicleId`); per-order consequences such as `ORDER_OUT_FOR_DELIVERY` are derived in the same transaction as `TRIP_DEPARTED`.
