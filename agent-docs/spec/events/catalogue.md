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
| `ORDER_DEFERRED` | Server / publish or system | reasonCode, causeKind, scoreInputs, toDate, note, decidedBy | -> DEFERRED |
| `PLAN_ACKNOWLEDGED` | Field / loader, driver | planVersion | none |
| `LOAD_SHORT` | Field / loader | lines[{lineId, qtyShort}], reasonCode, photoRef? | flag; notifies dispatcher + store |
| `LOAD_DAMAGED` | Field / loader | lines[{lineId, qty}], photoRef? | flag; notifies dispatcher |
| `LOAD_CONFIRMED` | Field / loader | lines[{lineId, qtyLoaded}] | -> LOADED |
| `TRIP_READY` | Field / loader (hold-to-confirm) | tripId | trip -> READY (requires all orders resolved) |
| `TRIP_DEPARTED` | Field / driver | tripId | trip -> DEPARTED; server derives `ORDER_OUT_FOR_DELIVERY` per LOADED order |
| `STOP_ARRIVED` | Field / driver | orderId | none (progress + last heard) |
| `STOP_OUTCOME` | Field / driver | outcome FULL, PARTIAL, REFUSED, FAILED; lines delivered/returned; reasonCode? | -> DELIVERED (FULL, PARTIAL) or FAILED |
| `POD_CAPTURED` | Field / driver | receiverName, signatureBlobRef?, photoBlobRefs[] | evidence attached |
| `PROBLEM_FLAGGED` | Field / driver | kind, note, photoRef? | dispatcher inbox |
| `RECEIPT_CONFIRMED` | Server / store | lines received | -> RECEIVED |
| `ISSUE_REPORTED` | Server / store | kind SHORT, DAMAGED, WARM, OTHER; lines; photo; note | -> DISPUTED; dispatcher inbox |
| `ISSUE_RESOLVED` | Server / dispatcher | CREDIT, ADD_TO_RUN, REJECT; note | -> RECEIVED; ADD_TO_RUN creates a follow-up order |
| `CONFLICT_OPENED` | Server | conflictId, kind, heldEventId | dispatcher inbox |
| `CONFLICT_RESOLVED` | Server / dispatcher | conflictId, ACCEPT_FACT or REJECT_FACT, note | reducer applies or drops the held event |

"Out for delivery" on the order timeline is server-derived from `TRIP_DEPARTED`. Trip-level facts are stored once (subject `tripId`); per-order consequences are derived in the same transaction.
