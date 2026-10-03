import type { Prisma } from "../../generated/prisma/client";
import type { Actor } from "./types";

export interface Scope {
  orders: Prisma.OrderWhereInput;
  trips: Prisma.TripWhereInput;
  outlets: Prisma.OutletWhereInput;
  vehicles: Prisma.VehicleWhereInput;
}

/**
 * Prisma `where` clauses that keep list queries inside the actor's scope. Combine with route filters using
 * `AND: [scoped(actor).orders, filter]` so a filter can never widen the scope.
 */
export function scoped(actor: Actor): Scope {
  switch (actor.role) {
    case "STORE": {
      const { outletId } = actor;
      return {
        orders: { outletId },
        trips: { stops: { some: { order: { outletId } } } },
        outlets: { id: outletId },
        vehicles: { trip_vehicleId: { some: { stops: { some: { order: { outletId } } } } } },
      };
    }
    case "DISPATCHER": {
      const depots = { in: [...actor.depots] };
      return {
        orders: { outlet: { depot: depots } },
        trips: { planningDay: { depot: depots } },
        outlets: { depot: depots },
        vehicles: { depot: depots },
      };
    }
    case "LOADER": {
      const { depot } = actor;
      return {
        orders: { outlet: { depot } },
        trips: { planningDay: { depot } },
        outlets: { depot },
        vehicles: { depot },
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
      };
    }
  }
}
