---
status: draft
owner: Dinura
sources: guide §12; issue 29; proposed ADR 0023
---

# API wire DTOs

This draft supplies the previously unspecified wire conventions for [API endpoints](api.md). These additions are proposed for owner review in [ADR 0023](../../adr/0023-api-wire-contracts.md); they are not accepted architecture yet. Schemas, inferred types, and synthetic web fixtures are exported by `@nextdrop/contracts`. Prisma records stay inside the API.

## Registration and access

`apiRoutes` is keyed by stable operation name. Each declaration has `method`, full `/api` path, `roles`, `access`, `transport`, `request` and `responses`. Schema references resolve through `apiSchemas`; `ApiDto<name>` and `ApiDtoInput<name>` expose output and input types. `apiRouteFixtures` contains every declared request part and response status; `apiFixtures` contains every named DTO. Fixtures are synthetic examples, not seed selections or real accounts.

`apiVariantFixtures` also exports every login/session role, loader/driver snapshot, sync result status and exception type. Sync registration uses `request.body = syncEventsIngressRequest` for batch framing and raw events, with `clientBody = syncEventsRequest` identifying the complete typed client DTO. The handler processes each raw event through `parseClientEvent(raw, batchDeviceId, index, receivedAt, registry?)`, using its original zero-based input index and server receipt time. This helper validates type/version framing, upcasts the unknown payload using the shared registry by default, then validates the complete current event and batch device identity. Malformed framing, failed upcasting or invalid upgraded data returns SCHEMA_INVALID; a valid event from a different device returns FORBIDDEN. A bad event must not abort valid neighbours. Accepted data has schemaVersion normalized to SCHEMA_VERSION to match its upgraded payload; the submitted object and capturedAt remain unchanged. Persist this normalized version with the normalized payload. `bodyLimit` is 1000000 serialized bytes for sync and `MAX_BLOB_BYTES` (524288 bytes) for blobs; both routes declare 413 responses and fixtures.

- `access: public` covers login, liveness, and readiness. Empty roles mean an unauthenticated ops endpoint, not a deny-all route. Login declares the four possible target roles.
- `access: session` requires session identity; list and resource ownership still use the API's central policy layer. The route table is the role ceiling, not the complete ownership policy.
- `access: expired-session` is used only by field reauth. The API accepts a retained session row identified by its cookie, even after expiry, but rejects revoked/missing sessions. It verifies the field role, device binding, PIN and CSRF header, applies rate limits (429), and renews credentials without changing the outbox. It never permits normal expired-session business mutations.
- `access: demo` requires `DEMO_MODE=true` and a dispatcher session or `x-nextdrop-script-key`. The API checks the key separately; the session path uses the declared CSRF headers. Never expose the script key in client mocks.
- Common JSON errors are exported as `apiCommonErrorResponses` (400, 401, 403, 429, 500); merge them with route-specific responses during registration. A transport-limit failure uses 413 and `PAYLOAD_TOO_LARGE`.
- Mutations carry `x-nextdrop-csrf`, a nonempty custom header checked by the API. Login uses the custom header for CSRF defence before a session exists. Session responses supply `csrfToken` for later mutations. Order creation also carries `idempotency-key`; it is not an order body property.
- Request schemas are split into path params, query, headers, and body. GET routes have no body. Missing request parts mean no DTO is expected for that part. Header schemas permit unrelated HTTP headers.
- Request bodies reject unknown keys, including reused mutation payloads and nested receipt/issue lines or fleet changes. Fleet requests omit server-owned `sourceEventId`; stored event payload schemas stay unchanged.
- Query limits accept numeric strings from HTTP and produce integers. Feed cursors are never coerced to numbers. Notification `unreadOnly` is the literal query string `true` or `false`.

## Shared values and projections

Resource primary IDs are UUIDs, with separate string `displayId` values. Line IDs and rule references remain nonempty strings. Dates are local `YYYY-MM-DD`; instants are ISO UTC with `Z`, using existing validators. Window open/close values are minutes since Colombo midnight. Number quantities are finite; count/quantity fields are integers where the source defines counts.

Reference DTOs use rules-owned brand, vehicle, dock, parking and temperature vocabularies. Vehicle capacity is grams/litres, fuel quota is millilitres, and economy is metres per litre. Products and order-line unit snapshots retain numeric `unitVolumeM3` and `unitWeightG`; aggregate order sizes are integer `weightG` and `volumeL`. These DTOs do not implement storage rounding or rules conversion policy.

- Outlet: identity, name, brand, district/depot, dock/parking, nullable mall window, delivery window, address, contact.
- Vehicle: identity, type/temperature, capacities, fuel type/economy/quota, depot, driver contact.
- Product: UUID, sku/name, brand/temperature, unit label and unit weight/volume.
- Calendar: local date, day/week/year, payday/festival/ramp, holiday/monsoon/operating flags.
- Order: identity, outlet, brand/temperature, requested/current dates, status, aggregate sizes, placed/confirmed timestamps, deferral count, replacement link, populated lines, short/damaged flags, assignment and deferral.
- Assignment and deferral are present nullable values: no current assignment or deferral is `null`, not omission. Confirmation and replacement links are also present nullable fields.
- Order detail wraps `{ order, timeline }`; timeline entries use the stored event envelope.
- Trip: identity, vehicle/trip number, brand/district/status, departure, minutes, distance/fuel, populated stops. Stops carry order, outlet, sequence, ETA band, window/service time, and separate arrived/delivered/confirmed timestamps. No field fact timestamp is merged with its confirmation time.

`rulesConfig` retains every current `RulesConfig` field, including priority order. `Violation` and `ValidationResult` are compatible in both directions with their rules types. Contracts validate shape; rules remain authoritative for semantic configuration and planning constraints.

## Auth and reference

Login body is discriminated by `role`:

| Role | Credentials |
| --- | --- |
| STORE | `loginId` (OUT### or email), `password` |
| DISPATCHER | `email`, `password`, `depot` |
| LOADER | `loginId` (LDR###), `pin`, `deviceId` |
| DRIVER | `loginId` (DRV###), `pin`, `deviceId` |

Login, me and reauth return `{ user, expiresAt, serverTime, csrfToken }`. User variants include common id/displayName/locale and the required role scope: store outlet, dispatcher depots, loader depot, driver vehicle. Reauth takes `{ role, pin, deviceId }` for loader/driver and uses the `expired-session` policy above; missing/revoked identity requires normal login. Logout returns `{ ok: true, serverTime }`.

Reference lists wrap `{ items }`. Optional depot query selection never overrides authorization. Calendar requires `from` and `to`. Reasons returns separate deferral, problem, load-short, and stop-outcome lists of `{ code, message_key }`.

## Store

- Cutoff and deliveries take a local `date` query. Cutoff returns requested/delivery dates, cutoff instant, ordering flag, nullable guidance key, and server time.
- Deliveries wraps order/trip, ONLINE or NO_SIGNAL, and nullable last-heard timestamp; the response includes server time.
- Create body is `{ requestedDate, lines: [{ productId, qty }], replacesOrderId? }`; positive integer quantities. API derives totals and event line IDs. Success is 201 with the order.
- Order list accepts optional date/status/after/limit and returns `{ items, nextCursor }` (null at end).
- Cancel, receipt, issue-report, and issue-resolution bodies reuse existing payload shapes. Path IDs supply the subject, so conflict resolution does not repeat conflict ID or held-event ID in its body.
- Cancel and receipt return the order. Issue report returns 201 `{ issueId, order }`.

## Dispatch

Day paths require a local `date`; day operations take `depot` in query. Day detail includes state, nullable close time/version, queue, demand/capacity stats, and server time. Propose takes `{ revision }`, where revision zero represents no saved draft, and returns `{ draft, stats, trace }`.

Draft data is `{ trips: [{ ref, vehicleId, tripNo, orderIds }], unassignedOrderIds, deferrals: [{ orderId, reasonCode?, note? }] }`. Order ID order is stop sequence. Rule inputs are assembled by the API from canonical scoped orders/reference data; a client does not send trusted order weights. A draft has revision, nullable base version, data and updated time. GET returns `{ draft }`, with null before creation. PUT takes `{ revision, data }`; the API performs optimistic concurrency and semantic validation.

Validate takes `{ data }` and returns `ValidationResult`. Publish takes `{ revision }` and returns `{ plan, serverTime }`. Versions wraps `{ items }`; each plan version includes published identity/time, populated trips, deferral explanations, and served/deferred/trip summary.

Hard validation fails with 422 `{ code: VALIDATION_FAILED, message_key, params, requestId, validation: ValidationResult }`. Missing deferral reasons use the same 422 structure with `MISSING_DEFERRAL_REASON`; the API must include the associated validation information. Locked stops use 409 `STOP_LOCKED`; stale revisions use 409 `REVISION_CONFLICT`. Warnings alone remain successful. Rules perform the checks; Zod does not reproduce them.

Runs wraps vehicle, trips, progress counts, separate last-heard/last-sync times, pending count, late risk and the documented state vocabulary, plus server time. Exceptions are discriminated CONFLICT, ISSUE, SHORT, DAMAGED, FAILED or PROBLEM rows. Fleet wraps date and vehicle/availability pairs. Read availability is `{ status, reason, note, changedAt }`, with required nullable reason/note/changedAt; a never-changed available vehicle has all three null. PUT takes `{ changes: [availability payloads without sourceEventId] }`. Outlook takes depot/from/weeks and returns weekly brand demand/chilled/capacity in litres. Outlet history returns `{ items, total, nextCursor }`; pass non-null nextCursor as the next after query, and null means completion.

## Field, feed and transport

The client sync envelope and batch are documented in [push protocol](../sync/push-protocol.md). The persisted event envelope is unchanged.

Snapshot is discriminated by `role`. Common fields are `planVersion`, `serverTime`, `feedCursor`, `resetEpoch`, `scope`, `config`. `planVersion` is null before publication. Loader scope is `{ depot, date, trips }`; driver scope is `{ date, vehicle, trips }`. Populated stops provide order lines, outlet contacts/docks/windows, and ETAs. Config is `{ rules, reasons, noSignalAfterMin, lateGraceMin }`. Snapshot replaces server-derived tables only; it does not contain or replace the outbox.

Heartbeat body is `{ deviceId, appVersion, pendingCount, lastSyncAt, lastKnownStop }`; the last two fields are required nullable values. Response is `{ serverTime, feedHead, resetEpoch }`.

Changes query is `{ after, limit? }`, with decimal-string after and limit 1..1000. Rows are `{ seq, kind, entity: { type, id }, version?, at }`. Response is `{ items, head, resetEpoch }`. Sequence/head/cursor fields accept canonical nonnegative decimal strings, preserving values above Number.MAX_SAFE_INTEGER. Stream takes an after cursor and sends SSE hints whose JSON data is `{ head, resetEpoch }`; this is a hint contract, not a JSON HTTP response serializer.

Blob upload has UUID path ID (= clientBlobId), an image content-type and CSRF header, and raw bytes. The proposed hard upload limit is 512 KiB (524288 bytes), leaving margin above the approximately 200 KB client compression target. `MAX_BLOB_BYTES` controls request bytes, response size and route transport cap. MIME is JPEG, PNG or WebP (photos and rasterized signatures). Zod checks bytes/metadata, while the API validates the actual content and transport size. Success is `{ clientBlobId, mime, size }`. No JSON/base64 blob body is introduced.

## Notifications, demo and ops

Notification list returns `{ items, unreadCount, nextCursor }`. Rows retain kind, localization title/params, entity link, created/read times and DELIVERIES/PLANNING/NEEDS_ACTION group. Read body is `{ all: true }` or `{ all: false, ids }` with a nonempty ID list; response is `{ updatedCount, readAt }`.

Demo state includes enabled flag, serverTime, clock offset, preset, reset epoch and nullable last reset actor/time. Clock takes `{ serverTime }`; reset takes `{ preset }`; both return state. Tick has no body and returns `{ transitionsApplied, serverTime }`. Existing confirmation, rate limiting and actor-banner rules still apply.

Health returns `{ status: 'ok' }`. Readiness preserves the existing API producer: 200 `{ status: 'ok', checks }` or 503 `{ status: 'unavailable', checks }`, with check values `ok` or `failed`. Ops schemas are not forced into the JSON business-error shape.

## Errors and verification

Business errors are `{ code, message_key, params, requestId }`; params is a scalar map. Shared error codes retain existing sync codes and add UNAUTHENTICATED, INVALID_CREDENTIALS, NOT_FOUND, REVISION_CONFLICT, VALIDATION_FAILED, RATE_LIMITED, PAYLOAD_TOO_LARGE and INTERNAL_ERROR for API boundaries. The 422 validation extension is explicit above.

Tests parse every named DTO and every route fixture through the public exports, comparing complete populated output. An independent endpoint inventory checks route coverage. Compile-time checks verify rules compatibility and discriminated event/login/snapshot/result variants. The role table feeds later API authorization tests; #29 does not implement or verify ownership authorization.
