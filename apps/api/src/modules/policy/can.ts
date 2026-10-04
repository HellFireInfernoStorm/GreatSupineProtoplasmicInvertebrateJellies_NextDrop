import { apiRoutes, type HumanRole } from "@nextdrop/contracts";
import type { Action, Actor, Resource } from "./types";

function inDepot(actor: Actor, depot: string): boolean {
  switch (actor.role) {
    case "DISPATCHER":
      return actor.depots.includes(depot);
    case "LOADER":
      return actor.depot === depot;
    default:
      return false;
  }
}

/**
 * Deny by default. The contracts route table is the role ceiling; ownership is then checked per resource kind:
 * store -> own outlet, dispatcher -> own depots, loader -> own depot, driver -> own vehicle's trips.
 */
export function can(actor: Actor | null, action: Action, resource: Resource): boolean {
  if (!actor) return false;
  const route = Object.hasOwn(apiRoutes, action) ? apiRoutes[action] : undefined;
  if (!route || route.access === "public") return false;
  if (!(route.roles as readonly HumanRole[]).includes(actor.role)) return false;

  switch (resource.kind) {
    case "self":
    case "collection":
      return true;
    case "depot":
      return inDepot(actor, resource.depot);
    case "outlet":
      return actor.role === "STORE" ? actor.outletId === resource.outletId : inDepot(actor, resource.depot);
    case "order":
      if (actor.role === "STORE") return actor.outletId === resource.outletId;
      if (actor.role === "DRIVER") return resource.vehicleIds.includes(actor.vehicleId);
      return inDepot(actor, resource.depot);
    case "trip":
      if (actor.role === "STORE") return resource.outletIds.includes(actor.outletId);
      if (actor.role === "DRIVER") return actor.vehicleId === resource.vehicleId;
      return inDepot(actor, resource.depot);
    case "vehicle":
      if (actor.role === "DRIVER") return actor.vehicleId === resource.vehicleId;
      return inDepot(actor, resource.depot);
    case "blob":
      if (resource.uploaderUserId !== null && resource.uploaderUserId === actor.userId) return true;
      if (actor.role === "STORE") return resource.outletId !== null && actor.outletId === resource.outletId;
      if (actor.role === "DISPATCHER") return resource.depot !== null && actor.depots.includes(resource.depot);
      return false;
    default:
      return false;
  }
}
