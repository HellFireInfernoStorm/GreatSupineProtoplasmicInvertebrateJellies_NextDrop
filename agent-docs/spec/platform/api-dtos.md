---
status: draft
owner: Dinura
sources: guide §12; issues 29, 59, 78, 110; accepted ADRs 0024, 0026, 0038, 0041
---

# API wire DTOs

The dispatcher day response includes required `planningContext`: `vehicleFuel[{vehicleId,usedOtherDaysThisWeekMl}]`, `outletService[{outletId,daysSinceLastServed,deferredLastRun}]`, and `loadedOrders[{orderId,vehicleId,tripNo,reversalRequested}]`. Identities are UUIDs; fuel is nonnegative integer millilitres, service age is a nonnegative integer day count, and trip number is 1 or 2. Context is generated from the existing authoritative planning inputs, scoped to the permitted depot and queue, with explicit zero usage for known vehicles. It is a fetch-time snapshot; server validation on save remains authoritative (ADR 0045 proposal).

This draft documents the wire conventions for [API endpoints](api.md) accepted in [ADR 0024](../../adr/0024-api-wire-contracts.md). Schemas, inferred types, and synthetic web fixtures are exported by `@nextdrop/contracts`. Prisma records stay inside the API.

## Registration and access

`apiRoutes` is keyed by stable operation name. Each declaration has `method`, full `/api` path, `roles`, `access`, `transport`, `request` and `responses`. Schema references resolve through `apiSchemas`; `ApiDto<name>` and `ApiDtoInput<name>` expose output and input types. `apiRouteFixtures` contains every declared request part and response status; `apiFixtures` contains every named DTO. Fixtures are synthetic examples, not seed selections or real accounts.

`apiVariantFixtures` also exports every login/session role, loader/driver snapshot, sync result status and exception type. Sync registration uses `request.body = syncEventsIngressRequest` for batch framing and raw events, with `clientBody = syncEventsRequest` identifying the complete typed client DTO. The handler processes each raw event through `parseClientEvent(raw, batchDeviceId, index, receivedAt, registry?)`, using its original zero-based input index and server receipt time. This helper validates type/version framing, upcasts the unknown payload using the shared registry by default, then validates the complete current event and batch device identity. Malformed framing, failed upcasting or invalid upgraded data returns SCHEMA_INVALID; a valid event from a different device returns FORBIDDEN. A bad event must not abort valid neighbours. Accepted data has schemaVersion normalized to SCHEMA_VERSION to match its upgraded payload; the submitted object and capturedAt remain unchanged. Persist this normalized version with the normalized payload. `bodyLimit` is 1000000 serialized bytes for sync and `MAX_BLOB_BYTES` (524288 bytes) for blobs; both routes declare 413 responses and fixtures.

- `access: public` covers login, liveness, and readiness. Empty roles mean an unauthenticated ops endpoint, not a deny-all route. Login declares the four possible target roles.
- `access: session` requires session identity; list and resource ownership still use the API's central policy layer. The route table is the role ceiling, not the complete ownership policy.
- `access: expired-session` is used only by field reauth. Cookie identity must resolve to a retained Session row with kind FIELD and request.deviceId equal to Session.deviceId. Renewal is accepted only before expiresAt + FIELD_REAUTH_GRACE_DAYS (default 30 days); at/beyond that boundary delete the row and require full login. Revocation deletes the row immediately; there is no revoked flag. Session sweepers retain expired FIELD rows until the window ends. Wrong PINs lock reauth for that session using the login lockout/backoff policy in [auth](auth.md), returning 429 while locked. Role/PIN/CSRF checks still apply; the outbox remains intact and normal expired-session business mutations are denied.
- `access: demo` requires `DEMO_MODE=true` and a dispatcher session or `x-nextdrop-script-key`, whose secret is DEMO_SCRIPT_KEY. If the key is unset/empty, the script-key path is disabled even when demo mode is enabled. The API checks the key separately; the session path uses the declared CSRF headers. Never expose the script key in client mocks.
- Common JSON errors are exported as `apiCommonErrorResponses` (400, 401, 403, 429, 500); merge them with route-specific responses during registration. A transport-limit failure uses 413 and `PAYLOAD_TOO_LARGE`.
- Mutations carry `x-nextdrop-csrf`, a nonempty custom header checked by the API. Login uses the custom header for CSRF defence before a session exists. Session responses supply `csrfToken` for later mutations. Order creation also carries `idempotency-key`; it is not an order body property.
- Request schemas are split into path params, query, headers, and body. GET routes have no body. Missing request parts mean no DTO is expected for that part. Header schemas permit unrelated HTTP headers.
- Request bodies reject unknown keys, including reused mutation payloads and nested receipt/issue lines or fleet changes. Fleet requests omit server-owned `sourceEventId`; stored event payload schemas stay unchanged.
- Query limits accept numeric strings from HTTP and produce integers. Feed cursors are never coerced to numbers. Notification `unreadOnly` is the literal query string `true` or `false`.

## Shared values and projections

Resource primary IDs are UUIDs, with separate string `displayId` values. Line IDs and rule references remain nonempty strings. Dates are local `YYYY-MM-DD`; instants are ISO UTC with `Z`, using existing validators. Window open/close values are minutes since Colombo midnight. Number quantities are finite; count/quantity fields are integers where the source defines counts.

Reference DTOs use rules-owned brand, vehicle, dock, parking and temperature vocabularies. Vehicle capacity is grams/litres, fuel quota is millilitres, and economy is metres per litre. Products and order-line unit snapshots retain numeric `unitVolumeM3` and `unitWeightG`; aggregate order sizes are integer `weightG` and `volumeL`. These DTOs do not implement storage rounding or rules conversion policy.

- Outlet: identity, name derived by the server as `Waypoint {brand}, {district}`, brand, district/depot, dock/parking, nullable mall window, delivery window, required nullable address and contact. The current reference/model has no address, so return null. With no linked store user contact is null; a linked User.displayName may supply contact.name, with phone null because the model has no user/outlet phone. Never invent either value. Driver contacts retain required name and phone.
- Vehicle: identity, type/temperature, capacities, fuel type/economy/quota, depot, driver contact.
- Product: UUID, sku/name, brand/temperature, unit label and unit weight/volume.
- Calendar: local date, day/week/year, payday/festival/ramp, holiday/monsoon/operating flags.
- Order: identity, outlet, brand/temperature, requested/current dates, status, aggregate sizes, placed/confirmed timestamps, deferral count, replacement link, populated lines, short/damaged flags, assignment and deferral. Required nullable `pendingReversal` is `{ to: PLANNED | DEFERRED, planVersion }`, projected from the reducer without its internal `next` decision.
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

Reference lists wrap `{ items }`. Optional depot query selection never overrides authorization: a depot outside the caller's scope returns an empty list (ADR 0038). A store sees its own brand's products; other roles see the whole catalogue. Calendar requires `from` and `to` and returns every date in that inclusive range, at most 366 days, with `from` not after `to`; otherwise 400 `SCHEMA_INVALID`. Reasons returns separate deferral, problem, load-short, and stop-outcome lists of `{ code, message_key }`.

## Store

- Cutoff and deliveries take a local `date` query. Cutoff returns requested/delivery dates, cutoff instant, ordering flag, nullable guidance key, and server time.
- Deliveries wraps order/trip, ONLINE or NO_SIGNAL, and nullable last-heard timestamp; the response includes server time.
- Create body is `{ requestedDate, lines: [{ productId, qty }], replacesOrderId? }`; positive integer quantities. API derives totals and event line IDs. Success is 201 with the order.
- Store order writes (ADR 0032):
  - **Order shape.** One order holds one temperature and the outlet's brand. Mixed, foreign-brand, unknown or repeated products return 422 `VALIDATION_FAILED`.
  - **Idempotency.** `idempotency-key` is unique per outlet; a retry returns the original order with 201.
  - **Delivery date.** `currentDate` is `rules.deliveryDateFor` on the server clock. Display IDs are `ORD#####`.
  - **Status changes.** Status moves only through `rules.applyEvent`, with a compare-and-set on the previous status. Illegal moves, lost races and no-op repeated cancels or receipts return 409 `ILLEGAL_TRANSITION`. A second issue on a disputed order is recorded.
  - **Deliveries.** A store's trip shows only its own stops. `signal` is NO_SIGNAL only while the trip is DEPARTED and its driver's devices have been silent for 10 minutes.
- Order list accepts optional date/status/after/limit and returns `{ items, nextCursor }` (null at end).
- Cancel, receipt, issue-report, and issue-resolution bodies reuse existing payload shapes. Path IDs supply the subject, so conflict resolution does not repeat conflict ID or held-event ID in its body.
- Cancel and receipt return the order. Issue report returns 201 `{ issueId, order }`. There is no Issue table: issueId, issue.id and the dispatch issue-resolution path ID are the ISSUE_REPORTED event's id. The issue projection's openedAt is that event's receivedAt; resolvedAt is the matching ISSUE_RESOLVED receivedAt, or null before resolution.

## Dispatch

Day paths require a local `date`; day operations take `depot` in query. Day detail includes state, nullable close time/version, queue, demand/capacity stats, and server time. Propose takes `{ revision }`, where revision zero represents no saved draft, and returns `{ draft, stats, trace }`.

The API maps stored zero to null for PlanningDay.currentVersion, PlanDraft.baseVersion and fieldSnapshot.planVersion. The first draft save atomically creates revision one; a persisted draft never has revision zero even though the database default is zero. The pre-existing planning-day state enum mismatch is tracked in [#79](https://github.com/HellFireInfernoStorm/GreatSupineProtoplasmicInvertebrateJellies_NextDrop/issues/79).

Draft data is `{ trips: [{ ref, vehicleId, tripNo, orderIds }], unassignedOrderIds, deferrals: [{ orderId, reasonCode?, note? }] }`. Order ID order is stop sequence. Rule inputs are assembled by the API from canonical scoped orders/reference data; a client does not send trusted order weights. A draft has revision, nullable base version, data and updated time. GET returns `{ draft }`, with null before creation. PUT takes `{ revision, data }`; the API performs optimistic concurrency and semantic validation.

Validate takes `{ data }` and returns `ValidationResult`. Publish takes `{ revision }` and returns `{ plan, serverTime }`. Versions wraps `{ items }`; each plan version includes published identity/time, populated trips, deferral explanations, and served/deferred/trip summary.

Hard validation fails with 422 `{ code: VALIDATION_FAILED, message_key, params, requestId, validation: ValidationResult }`. Missing deferral reasons use the same 422 structure with `MISSING_DEFERRAL_REASON`; the API must include the associated validation information. Locked stops use 409 `STOP_LOCKED`; stale revisions use 409 `REVISION_CONFLICT`. Warnings alone remain successful. Rules perform the checks; Zod does not reproduce them.

Runs wraps vehicle, trips, progress counts, separate last-heard/last-sync times, pending count, late risk and the documented state vocabulary, plus server time. Exceptions are discriminated ACK, CONFLICT, ISSUE, SHORT, DAMAGED, FAILED or PROBLEM rows. CONFLICT, ISSUE, DAMAGED and PROBLEM rows carry `evidence`, the blob IDs of their photos and signatures, readable through `GET /blobs/:id` (ADR 0041). ACK is `{ type: ACK, tripId, planVersion, actor, at }`, projected from PLAN_ACKNOWLEDGED subject.tripId, payload.planVersion, actor and capturedAt to match the design's Ack inbox row. Conflict.orderId is required nullable for trip-level conflicts; tripId and resolution are also required nullable. `apiConflictFixtures` exports order-level, trip-level and resolved examples. Fleet wraps date and vehicle/availability pairs. Read availability is `{ status, reason, note, changedAt }`, with required nullable reason/note/changedAt; a never-changed available vehicle has all three null. PUT takes `{ changes: [availability payloads without sourceEventId] }`. Outlook takes depot/from/weeks and returns weekly brand demand/chilled/capacity in litres. Outlet history returns `{ items, total, nextCursor }`; pass non-null nextCursor as the next after query, and null means completion.

### Dispatcher dock commands (ADR 0026)

Both commands require a DISPATCHER session and `mutationHeaders` (CSRF), use JSON, and retain common 400/401/403/429/500 responses.

`resolveShort`: `POST /api/dispatch/orders/:id/shorts/:lineId/resolve`, params `{ id: uuidV7, lineId: nonempty }`, strict body `{ outcome: SHIP_PARTIAL | HOLD_TRIP | BACKORDER, note? }`. Path IDs are omitted from the existing SHORT_RESOLVED payload schema. Success is 200 `{ order, backorder: order | null, serverTime }`. The system proposes SHIP_PARTIAL; the UI preselects it for dispatcher confirmation/change. BACKORDER emits SHORT_RESOLVED and ORDER_PLACED in the same transaction. The follow-up order has `replacesOrderId` pointing to the original, one line with the short line's product (`skuId` in ORDER_PLACED), and quantity `qtyShort`. Its requested date is `nextOperatingDate(original.currentDate)` from rules/calendar.ts. It is server-authored, so store cutoff does not apply. Its idempotency key is `backorder:<orderId>:<lineId>`. Other outcomes return backorder null. Repeating the same outcome returns 200/current state with the same response shape as the first call: for BACKORDER, backorder is the existing follow-up found by idempotency key `backorder:<orderId>:<lineId>`; for other outcomes it remains null. No new event or follow-up order is emitted; SHIP_PARTIAL and BACKORDER are final: any different outcome on a line resolved to either, including HOLD_TRIP, returns 409 ILLEGAL_TRANSITION. HOLD_TRIP is not final: re-resolving it to SHIP_PARTIAL or BACKORDER returns 200 and emits a new SHORT_RESOLVED; BACKORDER creates the follow-up as usual. HOLD_TRIP to HOLD_TRIP is a same-outcome retry (200, no new event). Missing/out-of-scope order, missing line, or no LOAD_SHORT returns 404 NOT_FOUND. TRIP_READY remains refused while any short line on the trip is unresolved or on HOLD_TRIP; the UI shows "waiting on dispatcher" for unresolved shorts or "held by dispatcher" for HOLD_TRIP. #51 implements the transaction and the HOLD_TRIP rules/readiness change, under the owner decision recorded in ADR 0026.

`requestReversal`: `POST /api/dispatch/orders/:id/reversal`, params `idParams`, strict body `{ to: PLANNED | DEFERRED }`. The existing LOAD_REVERSAL_REQUESTED schema omits body orderId and planVersion; the server uses the planning day's current published version. Success is 200 `{ order, serverTime }` with order still LOADED and pendingReversal set. Repeating the same pending target returns 200 without another event. A non-LOADED order (reducer NOT_LOADED) or different already-pending target returns 409 ILLEGAL_TRANSITION; a missing/out-of-scope order returns 404 NOT_FOUND. The old assignment remains until LOAD_REVERSED; newly published decisions wait with WAITING_FOR_REVERSAL. Cancellation is out of scope. #60 implements this workflow.

`apiShortResolutionFixtures` exports all three outcomes, including a populated one-line backorder. `apiOrderReversalFixtures` exports orders with null/pending reversal, and `apiLoaderReversalFixture` shows reversal tasks independent of current trips. No stored event payload or SCHEMA_VERSION changes.

## Field, feed and transport

The client sync envelope and batch are documented in [push protocol](../sync/push-protocol.md). The persisted event envelope is unchanged.

Snapshot is discriminated by `role`. Common fields are `planVersion`, `serverTime`, `feedCursor`, `resetEpoch`, `scope`, `config`. `planVersion` is null before publication. Loader scope is `{ depot, date, trips, reversals }`; `reversals` contains the depot/date orders that are LOADED with pendingReversal, regardless of the current plan. These loader tasks are confirmed through the existing LOAD_REVERSED field event. Driver scope is `{ date, vehicle, trips }`. Populated stops provide order lines, outlet contacts/docks/windows, and ETAs. Config is `{ rules, reasons, noSignalAfterMin, lateGraceMin }`. `reasons` includes `deferral`, `problems`, `loadShort`, `loadDamaged` and `stopOutcome` (ADR 0042 for damage codes). Snapshot replaces server-derived tables only; it does not contain or replace the outbox.

Heartbeat body is `{ deviceId, appVersion, pendingCount, lastSyncAt, lastKnownStop }`; the last two fields are required nullable values. Response is `{ serverTime, feedHead, resetEpoch }`.

Changes query is `{ after, limit? }`, with decimal-string after and limit 1..1000. Rows are `{ seq, kind, entity: { type, id }, version?, at }`. Response is `{ items, head, resetEpoch }`. Sequence/head/cursor fields accept canonical nonnegative decimal strings, preserving values above Number.MAX_SAFE_INTEGER. Stream takes an after cursor and sends SSE hints whose JSON data is `{ head, resetEpoch }`; this is a hint contract, not a JSON HTTP response serializer.

Blob upload has UUID path ID (= clientBlobId), an image content-type and CSRF header, and raw bytes. The hard upload limit is 512 KiB (524288 bytes), leaving margin above the approximately 200 KB client compression target. `MAX_BLOB_BYTES` controls request bytes, response size and route transport cap. MIME is JPEG, PNG or WebP (photos and rasterized signatures). Zod checks bytes/metadata, while the API validates the actual content and transport size. Success is `{ clientBlobId, mime, size }`. No JSON/base64 blob body is introduced.

## Notifications, demo and ops

Notification list returns `{ items, unreadCount, nextCursor }`. Rows retain kind, localization title/params, entity link, created/read times and DELIVERIES/PLANNING/NEEDS_ACTION group. Read body is `{ all: true }` or `{ all: false, ids }` with a nonempty ID list; response is `{ updatedCount, readAt }`.

Demo state includes enabled flag, serverTime, clock offset, preset, reset epoch and nullable last reset actor/time. Clock takes `{ serverTime }`; reset takes `{ preset }`; both return state. Tick has no body and returns `{ transitionsApplied, serverTime }`. Existing confirmation, rate limiting and actor-banner rules still apply.

Health returns `{ status: 'ok' }`. Readiness preserves the existing API producer: 200 `{ status: 'ok', checks }` or 503 `{ status: 'unavailable', checks }`, with check values `ok` or `failed`. Ops schemas are not forced into the JSON business-error shape.

## Errors and verification

Business errors are `{ code, message_key, params, requestId }`; params is a scalar map. Shared error codes retain existing sync codes and add UNAUTHENTICATED, INVALID_CREDENTIALS, NOT_FOUND, REVISION_CONFLICT, VALIDATION_FAILED, RATE_LIMITED, PAYLOAD_TOO_LARGE and INTERNAL_ERROR for API boundaries. The 422 validation extension is explicit above.

Tests parse every named DTO and every route fixture through the public exports, comparing complete populated output. An independent endpoint inventory checks route coverage. Compile-time checks verify rules compatibility and discriminated event/login/snapshot/result variants. The role table feeds later API authorization tests; #29 does not implement or verify ownership authorization.
