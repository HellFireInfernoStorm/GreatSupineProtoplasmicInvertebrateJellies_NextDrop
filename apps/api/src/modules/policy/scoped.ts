import type { Prisma } from "../../generated/prisma/client";
import type { Actor } from "./types";

export interface Scope {
  orders: Prisma.OrderWhereInput;
  trips: Prisma.TripWhereInput;
  outlets: Prisma.OutletWhereInput;
  vehicles: Prisma.VehicleWhereInput;
  /** Audience filter (ADR 0027): the role is listed and the row matches the role's scope column, or is unscoped. */
  changeFeed: Prisma.ChangeFeedWhereInput;
  /** Notifications are fanned out per user, so a user reads only their own rows. */
  notifications: Prisma.NotificationWhereInput;
}

/** A feed row with no depot, vehicle or outlet reaches every role it lists. */
const unscopedRow = { depot: null, vehicleId: null, outletId: null } satisfies Prisma.ChangeFeedWhereInput;

function audience(actor: Actor, match: Prisma.ChangeFeedWhereInput): Prisma.ChangeFeedWhereInput {
  return { roles: { has: actor.role }, OR: [match, unscopedRow] };
}

/**
 * Prisma `where` clauses that keep list queries inside the actor's scope. Combine with route filters using
 * `AND: [scoped(actor).orders, filter]` so a filter can never widen the scope.
 */
export function scoped(actor: Actor): Scope {
  const notifications = { userId: actor.userId };
  switch (actor.role) {
    case "STORE": {
      const { outletId } = actor;
      return {
        orders: { outletId },
        trips: { stops: { some: { order: { outletId } } } },
        outlets: { id: outletId },
        vehicles: { trip_vehicleId: { some: { stops: { some: { order: { outletId } } } } } },
        changeFeed: audience(actor, { outletId }),
        notifications,
      };
    }
    case "DISPATCHER": {
      const depots = { in: [...actor.depots] };
      return {
        orders: { outlet: { depot: depots } },
        trips: { planningDay: { depot: depots } },
        outlets: { depot: depots },
        vehicles: { depot: depots },
        changeFeed: audience(actor, { depot: depots }),
        notifications,
      };
    }
    case "LOADER": {
      const { depot } = actor;
      return {
        orders: { outlet: { depot } },
        trips: { planningDay: { depot } },
        outlets: { depot },
        vehicles: { depot },
        changeFeed: audience(actor, { depot }),
        notifications,
      };
    }
    case "DRIVER": {
      const { vehicleId } = actor;
      const onOwnTrip = { tripStop_orderId: { some: { trip: { vehicleId } } } } satisfies Prisma.OrderWhereInput;
      return {
        orders: onOwnTrip,
        trips: { vehicleId },
        outlets: { order_outletId: { some: onOwnTrip } },
        vehicles: { id: vehicleId },
        changeFeed: audience(actor, { vehicleId }),
        notifications,
      };
    }
  }
}
