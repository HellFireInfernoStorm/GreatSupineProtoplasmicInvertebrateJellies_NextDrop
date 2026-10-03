// Notifications (spec/platform/notifications-and-monitoring.md): per-user rows, in-app channel only (ADR 0013).
export {
  createNotifier,
  groupOf,
  inAppChannel,
  NOTIFICATION_GROUPS,
  type NotificationAudience,
  type NotificationChannel,
  type NotificationGroup,
  type NotificationInput,
  type NotificationKind,
  type Notifier,
  type Recipient,
} from "./notifier";
export { notificationRoutes, type NotificationRouteDependencies } from "./routes";
