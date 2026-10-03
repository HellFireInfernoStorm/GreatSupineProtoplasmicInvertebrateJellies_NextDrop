# ADR 0029: Feed audience, catch-up protocol and notification delivery

- Status: proposed
- Date: 2026-10-03
- Issue / PR: #41
- Designathon departure: no

## Context

The [change feed](../spec/sync/change-feed.md) says rows are "audience-filtered" using the `ChangeFeed` columns depot, vehicleId, outletId and roles, but does not say how they combine. [Notifications](../spec/platform/notifications-and-monitoring.md) need per-user read state and a DELIVERIES/PLANNING/NEEDS_ACTION group ([API wire DTOs](../spec/platform/api-dtos.md)). The `Notification` table has a single `readAt`, may address a role plus scope, and has no group column. The SSE hint must notice new rows from any writer.

## Decision

1. **Feed visibility.** A row is visible to an actor when the actor's role is in `roles` and the row matches that role's scope column: store `outletId`, dispatcher `depot` in its depots, loader `depot`, driver `vehicleId`. A row with no depot, vehicle or outlet reaches every role it lists. Writers fill every scope column that applies (an order row sets outletId and depot, plus vehicleId once assigned). `appendFeed` refuses a row with no roles.
2. **Catch-up protocol.** `GET /changes` reads `head` first and returns visible rows with `after < seq <= head`, ordered by seq. When a response holds fewer than `limit` items the client moves its cursor to `head`; otherwise to the last item's seq. Rows filtered out for this caller never stall it, and a row that commits after the head read is picked up next time.
3. **Notification fan-out.** Notifying a role and scope creates one `Notification` row per matching user, with `userId` set and the addressed scope recorded. `readAt` is therefore per user. A dispatcher whose `User.depot` is null (every depot, ADR 0026) receives notifications for every depot. One `notification_created` feed row per call is the in-app hint.
4. **Group and title.** The popover group is derived from the notification kind through one kind→group map in the API notifications module. `titleKey` is `notifications.<kind>`. Unknown stored kinds show as NEEDS_ACTION.
5. **Channels.** `NotificationChannel.deliver` runs inside the writing transaction and returns feed rows. The caller appends those rows, with its own, as the transaction's last statements. In-app is the only channel (ADR 0013).
6. **SSE.** `/stream` writes to the raw response with `X-Accel-Buffering: no` and `Cache-Control: no-cache, no-transform`. It sends `{ head, resetEpoch }` on connect and whenever either changes, a comment heartbeat every 25 s, and ends when the session is gone. One shared poller per process reads head and resetEpoch every second while any stream is open.

## Alternatives considered

- **A `group` column and a `NotificationRead` table**: two schema changes for data the kind already implies, and per-user reads that fan-out gives for free.
- **Shared role-scoped notification rows with one `readAt`**: one user's read would clear everyone's unread dot.
- **LISTEN/NOTIFY for SSE**: lower latency, but it needs a dedicated connection with reconnect handling and still misses demo resets that do not touch the counter. One indexed single-row read per second is cheap at this scale. The change-feed spec keeps LISTEN/NOTIFY as the scale-out path.
- **Strict scope only (no unscoped rows)**: global events such as demo resets or depot-agnostic dispatcher notices would need one row per scope.

## Consequences

- Publish (#48), ingest (#47) and the other writers must set roles and every applicable scope column. A driver only sees rows carrying its vehicleId, so a plan publish writes one row per affected vehicle (or an unscoped row).
- A new notification kind must be added to the kind→group map.
- Users created after a notification was sent do not receive it.
- Spec edits in this PR: `sync/change-feed.md` and `platform/notifications-and-monitoring.md`.
