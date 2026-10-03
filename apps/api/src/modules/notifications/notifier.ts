import type { ApiError } from "@nextdrop/contracts";
import type { Prisma, Role } from "../../generated/prisma/client";
import type { FeedAudience, FeedRowInput } from "../feed";

export type NotificationGroup = "DELIVERIES" | "PLANNING" | "NEEDS_ACTION";

/**
 * Notification kinds and their popover group (spec/platform/notifications-and-monitoring.md, design D0 popover).
 * The group is derived from the kind, so there is no group column (ADR 0027). Add new kinds here.
 */
export const NOTIFICATION_GROUPS = {
  // Store manager
  deferral_notice: "PLANNING",
  eta_updated: "DELIVERIES",
  delivered: "DELIVERIES",
  dispute_updated: "DELIVERIES",
  // Loader and driver
  plan_changed: "PLANNING",
  // Dispatcher
  orders_closed: "PLANNING",
  short_reported: "NEEDS_ACTION",
  damaged_reported: "NEEDS_ACTION",
  problem_reported: "NEEDS_ACTION",
  conflict_opened: "NEEDS_ACTION",
  dispute_opened: "NEEDS_ACTION",
  stop_failed: "NEEDS_ACTION",
  // Dispatcher, plus loader and driver of the affected trips (ADR 0017)
  vehicle_breakdown: "NEEDS_ACTION",
} as const satisfies Record<string, NotificationGroup>;

export type NotificationKind = keyof typeof NOTIFICATION_GROUPS;

export function groupOf(kind: string): NotificationGroup {
  return Object.hasOwn(NOTIFICATION_GROUPS, kind) ? NOTIFICATION_GROUPS[kind as NotificationKind] : "NEEDS_ACTION";
}

/** One user, or every user of a role within one scope. */
export type NotificationAudience =
  | { userId: string }
  | { role: "STORE"; outletId: string }
  | { role: "DISPATCHER"; depot: string }
  | { role: "LOADER"; depot: string }
  | { role: "DRIVER"; vehicleId: string };

export interface NotificationInput {
  kind: NotificationKind;
  audience: NotificationAudience;
  /** Localization parameters for `notifications.<kind>`. */
  params?: ApiError["params"];
  /** The screen the item links to. */
  entity: { type: string; id: string };
}

export interface Recipient {
  userId: string;
  role: Role;
  depot: string | null;
  vehicleId: string | null;
  outletId: string | null;
}

/** A delivery channel. Runs inside the writing transaction and returns feed rows for the caller to append last. */
export interface NotificationChannel {
  readonly name: string;
  deliver(
    tx: Prisma.TransactionClient,
    input: NotificationInput,
    recipients: readonly Recipient[],
  ): Promise<FeedRowInput[]>;
}

function feedAudience(audience: NotificationAudience, recipients: readonly Recipient[]): FeedAudience {
  if (!("userId" in audience)) {
    const { role, ...scope } = audience;
    return { roles: [role], ...scope };
  }
  const [user] = recipients;
  if (!user) return { roles: [] };
  switch (user.role) {
    case "STORE":
      return { roles: ["STORE"], outletId: user.outletId };
    case "DRIVER":
      return { roles: ["DRIVER"], vehicleId: user.vehicleId };
    default:
      // A dispatcher with no depot covers every depot, so the hint is unscoped for dispatchers.
      return { roles: [user.role], depot: user.depot };
  }
}

/**
 * In-app delivery: one Notification row per recipient, which gives each user their own read state, plus one
 * `notification_created` feed hint. The only channel: no SMS (ADR 0013); Web Push is a later, optional channel.
 */
export const inAppChannel: NotificationChannel = {
  name: "in-app",
  async deliver(tx, input, recipients) {
    if (recipients.length === 0) return [];
    // Record the addressed scope next to each recipient; a direct-to-user notification has none.
    const { audience } = input;
    const scope = {
      depot: "depot" in audience ? audience.depot : null,
      vehicleId: "vehicleId" in audience ? audience.vehicleId : null,
      outletId: "outletId" in audience ? audience.outletId : null,
    };
    const rows = await tx.notification.createManyAndReturn({
      data: recipients.map((recipient) => ({
        userId: recipient.userId,
        role: recipient.role,
        ...scope,
        kind: input.kind,
        titleKey: `notifications.${input.kind}`,
        params: input.params ?? {},
        entityRef: input.entity,
      })),
      select: { id: true },
    });
    return [
      {
        kind: "notification_created",
        entity: { type: "notification", id: rows[0]!.id },
        audience: feedAudience(input.audience, recipients),
      },
    ];
  },
};

async function resolveRecipients(tx: Prisma.TransactionClient, audience: NotificationAudience): Promise<Recipient[]> {
  const select = { id: true, role: true, depot: true, vehicleId: true, outletId: true } as const;
  let where: Prisma.UserWhereInput;
  if ("userId" in audience) where = { id: audience.userId };
  else if (audience.role === "STORE") where = { role: "STORE", outletId: audience.outletId };
  else if (audience.role === "DISPATCHER")
    where = { role: "DISPATCHER", OR: [{ depot: audience.depot }, { depot: null }] };
  else if (audience.role === "LOADER") where = { role: "LOADER", depot: audience.depot };
  else where = { role: "DRIVER", vehicleId: audience.vehicleId };
  const users = await tx.user.findMany({ where, select, orderBy: { id: "asc" } });
  return users.map(({ id, ...rest }) => ({ userId: id, ...rest }));
}

export interface Notifier {
  /**
   * Create a notification inside a writing transaction. Append the returned feed rows with `appendFeed` as the
   * transaction's last statements, together with the caller's own feed rows.
   */
  notify(tx: Prisma.TransactionClient, input: NotificationInput): Promise<FeedRowInput[]>;
}

export function createNotifier(channels: readonly NotificationChannel[] = [inAppChannel]): Notifier {
  return {
    async notify(tx, input) {
      const recipients = await resolveRecipients(tx, input.audience);
      const feed: FeedRowInput[] = [];
      for (const channel of channels) feed.push(...(await channel.deliver(tx, input, recipients)));
      return feed;
    },
  };
}
