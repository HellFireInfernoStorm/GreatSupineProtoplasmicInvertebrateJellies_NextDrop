import { apiRoutes, HUMAN_ROLES, type ApiRouteDefinition, type ApiRouteName } from "@nextdrop/contracts";
import type { Actor, Resource } from "../../src/modules/policy";

const base = { userId: "own-user", sessionId: "018f0000-0000-7000-8000-000000000001" };
export const actors: readonly Actor[] = [
  { ...base, role: "STORE", outletId: "own-outlet", depot: "Own depot" },
  { ...base, role: "DISPATCHER", depots: ["Own depot"] },
  { ...base, role: "LOADER", depot: "Own depot", deviceId: null },
  { ...base, role: "DRIVER", vehicleId: "own-vehicle", depot: "Own depot", deviceId: null },
];

// Independent ownership oracle. In particular, sharing a depot must not widen store/driver scope.
export const resources: readonly { name: string; resource: Resource; owners: readonly Actor["role"][] }[] = [
  { name: "self", resource: { kind: "self" }, owners: HUMAN_ROLES },
  { name: "collection", resource: { kind: "collection" }, owners: HUMAN_ROLES },
  { name: "own depot", resource: { kind: "depot", depot: "Own depot" }, owners: ["DISPATCHER", "LOADER"] },
  { name: "foreign depot", resource: { kind: "depot", depot: "Foreign depot" }, owners: [] },
  {
    name: "own outlet",
    resource: { kind: "outlet", outletId: "own-outlet", depot: "Own depot" },
    owners: ["STORE", "DISPATCHER", "LOADER"],
  },
  {
    name: "foreign outlet, same depot",
    resource: { kind: "outlet", outletId: "foreign-outlet", depot: "Own depot" },
    owners: ["DISPATCHER", "LOADER"],
  },
  {
    name: "foreign outlet",
    resource: { kind: "outlet", outletId: "foreign-outlet", depot: "Foreign depot" },
    owners: [],
  },
  {
    name: "own order",
    resource: { kind: "order", outletId: "own-outlet", depot: "Own depot", vehicleIds: ["own-vehicle"] },
    owners: HUMAN_ROLES,
  },
  {
    name: "foreign order, same depot",
    resource: { kind: "order", outletId: "foreign-outlet", depot: "Own depot", vehicleIds: ["foreign-vehicle"] },
    owners: ["DISPATCHER", "LOADER"],
  },
  {
    name: "foreign order",
    resource: { kind: "order", outletId: "foreign-outlet", depot: "Foreign depot", vehicleIds: ["foreign-vehicle"] },
    owners: [],
  },
  {
    name: "own trip",
    resource: { kind: "trip", depot: "Own depot", vehicleId: "own-vehicle", outletIds: ["own-outlet"] },
    owners: HUMAN_ROLES,
  },
  {
    name: "foreign trip, same depot",
    resource: { kind: "trip", depot: "Own depot", vehicleId: "foreign-vehicle", outletIds: ["foreign-outlet"] },
    owners: ["DISPATCHER", "LOADER"],
  },
  {
    name: "foreign trip",
    resource: { kind: "trip", depot: "Foreign depot", vehicleId: "foreign-vehicle", outletIds: ["foreign-outlet"] },
    owners: [],
  },
  {
    name: "own vehicle",
    resource: { kind: "vehicle", depot: "Own depot", vehicleId: "own-vehicle" },
    owners: ["DISPATCHER", "LOADER", "DRIVER"],
  },
  {
    name: "foreign vehicle, same depot",
    resource: { kind: "vehicle", depot: "Own depot", vehicleId: "foreign-vehicle" },
    owners: ["DISPATCHER", "LOADER"],
  },
  {
    name: "foreign vehicle",
    resource: { kind: "vehicle", depot: "Foreign depot", vehicleId: "foreign-vehicle" },
    owners: [],
  },
];

export const routes = Object.entries(apiRoutes) as [ApiRouteName, ApiRouteDefinition][];
export const matrix = routes.flatMap(([action, route]) =>
  actors.flatMap((actor) =>
    resources.map((scenario) => ({
      action,
      route,
      actor,
      ...scenario,
      allowed: route.access !== "public" && route.roles.includes(actor.role) && scenario.owners.includes(actor.role),
    })),
  ),
);
