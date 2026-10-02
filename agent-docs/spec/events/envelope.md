---
status: draft
owner: Dinura
sources: guide §7, §7.1
---

# Event envelope

## 7.1 Envelope (zod, in `contracts`)

```
EventEnvelope {
  id              uuid v7 (server-assigned)
  clientEventId?  uuid v7 (field events; idempotency key)
  deviceId?, deviceSeq?   per-device monotonic counter
  type, schemaVersion
  subject         { orderId?, tripId?, vehicleId? }
  source          SERVER | FIELD
  actor           { userId, role }
  capturedAt      device time (FIELD) or server time (SERVER)
  clockOffsetMs?  serverTime - deviceTime as last known when captured
  receivedAt      server time at ingest
  basedOnPlanVersion?   plan version the actor was looking at
  disposition     APPLIED | HELD   (immutable, set at insert)
  payload         type-specific, validated by zod
}
```

`subject.vehicleId` is for vehicle-level facts such as `VEHICLE_AVAILABILITY_CHANGED` (catalogue footnote, ADR 0017).

Two kinds of events: **server-authored** (from REST commands by store and dispatcher) and **field-authored** (driver and loader, via the outbox). Both land in the same table.
