# ADR 0026: Short-resolution and load-reversal routes

- Status: accepted
- Date: 2026-10-03
- Issue / PR: #78 (explicit owner decisions, 2026-10-03)
- Designathon departure: no

## Context

ADRs [0005](0005-shortfall-resolution.md) and [0004](0004-loaded-orders-and-plan-changes.md) define dock shortfall resolution and load reversal, but the shared API inventory lacked dispatcher commands. [ADR 0024](0024-api-wire-contracts.md) left this open under #78. The owner settled routes, DTOs, errors, retry behavior and reversal visibility in issue #78 and explicitly authorized this accepted ADR. Handler implementation stays in #51 and #60.

## Decision

Add DISPATCHER/session JSON commands with mutationHeaders:

- `apiRoutes.resolveShort`: POST /api/dispatch/orders/:id/shorts/:lineId/resolve. orderLineParams uses UUID order id and nonempty lineId. The strict SHORT_RESOLVED-derived request omits orderId/lineId and accepts outcome SHIP_PARTIAL, HOLD_TRIP or BACKORDER and optional note. Return 200 { order, backorder: order | null, serverTime }. Missing/out-of-scope order, missing line or no LOAD_SHORT returns 404 NOT_FOUND; a different outcome on an already-resolved line returns 409 ILLEGAL_TRANSITION. Retrying the same outcome returns current state in the same response shape as the first call, without new events: BACKORDER returns the existing follow-up found by idempotency key backorder:<orderId>:<lineId>, while other outcomes keep backorder null.
- `apiRoutes.requestReversal`: POST /api/dispatch/orders/:id/reversal. idParams and a strict LOAD_REVERSAL_REQUESTED-derived request omit orderId/planVersion, leaving { to: PLANNED | DEFERRED }. The server supplies the current published plan version. Return 200 { order, serverTime }; the order remains LOADED with pendingReversal. A non-LOADED order or different pending target returns 409 ILLEGAL_TRANSITION, missing/out-of-scope returns 404 NOT_FOUND, and a same-target retry emits no event.
- Keep the common 400/401/403/429/500 response contracts.

SHIP_PARTIAL is a proposal preselected by the UI for dispatcher confirmation or change. BACKORDER emits SHORT_RESOLVED and ORDER_PLACED atomically, with replacesOrderId pointing to the original, one line using the short line's product (ORDER_PLACED skuId), and quantity qtyShort. The requested date is rules nextOperatingDate(original.currentDate); store cutoff does not apply to this server-authored order. Use idempotency key backorder:<orderId>:<lineId>. TRIP_READY remains blocked by unresolvedShortLines and shows waiting on dispatcher until resolution.

Expose required nullable order.pendingReversal { to, planVersion }, projected from the reducer. Loader snapshot scope adds reversals: orderSchema[] for depot/date LOADED orders with a pending request, regardless of current plan membership. Preserve the old assignment until LOAD_REVERSED; later published decisions remain WAITING_FOR_REVERSAL. The loader confirms using the existing field event. Driver scope is unchanged; reversal cancellation is outside scope.

## Alternatives considered

- Continue documenting events without dispatcher routes: leaves shortfalls unable to resolve and reversal tasks invisible.
- Accept IDs/version in request bodies: duplicates path subjects and permits a client to choose server-owned version.
- Infer reversal tasks only from current trips: loses tasks when a newly published plan no longer contains the old assignment.

## Consequences

This closes ADR 0024's #78 route-decision item. platform/api.md and platform/api-dtos.md describe the wire contracts in place. Shared fixtures, route inventory (50 endpoints), and trust-boundary tests cover the changes. Existing payload schemas and SCHEMA_VERSION are unchanged. #51 and #60 implement persistence, event emission, notification and retry enforcement; web work remains separate.
