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
  // Blobs (ADR 0035): the depot's dispatcher, the outlet's store, the uploading user; a loader's depot is not enough.
  {
    name: "own outlet's blob, uploaded by someone else",
    resource: { kind: "blob", depot: "Own depot", outletId: "own-outlet", uploaderUserId: "other-user" },
    owners: ["STORE", "DISPATCHER"],
  },
  {
    name: "own upload in a foreign depot",
    resource: { kind: "blob", depot: "Foreign depot", outletId: "foreign-outlet", uploaderUserId: "own-user" },
    owners: HUMAN_ROLES,
  },
  {
    name: "foreign blob",
    resource: { kind: "blob", depot: "Foreign depot", outletId: "foreign-outlet", uploaderUserId: "other-user" },
    owners: [],
  },
  { name: "unlinked blob", resource: { kind: "blob", depot: null, outletId: null, uploaderUserId: null }, owners: [] },
];

export const routes = Object.entries(apiRoutes) as [ApiRouteName, ApiRouteDefinition][];
// Reviewed role ceiling, independent of the live contracts read by can(). New actions require review here.
const all = ["STORE", "DISPATCHER", "LOADER", "DRIVER"] as const;
const store = ["STORE"] as const;
const dispatch = ["DISPATCHER"] as const;
const field = ["LOADER", "DRIVER"] as const;
export const expectedRoles = {
  login: all,
  logout: all,
  me: all,
  reauth: field,
  outlets: all,
  vehicles: all,
  products: all,
  calendar: all,
  reasons: all,
  storeCutoff: store,
  storeDeliveries: store,
  createOrder: store,
  storeOrders: store,
  storeOrder: store,
  cancelOrder: store,
  receipt: store,
  reportIssue: store,
  storeNotifications: store,
  storeNotificationsRead: store,
  notifications: all,
  notificationsRead: all,
  dispatchDay: dispatch,
  propose: dispatch,
  getDraft: dispatch,
  saveDraft: dispatch,
  validate: dispatch,
  publish: dispatch,
  versions: dispatch,
  runs: dispatch,
  exceptions: dispatch,
  resolveConflict: dispatch,
  resolveIssue: dispatch,
  resolveShort: dispatch,
  requestReversal: dispatch,
  getFleet: dispatch,
  updateFleet: dispatch,
  outlook: dispatch,
  outletHistory: dispatch,
  snapshot: field,
  syncEvents: field,
  uploadBlob: field,
  blob: all,
  heartbeat: field,
  changes: all,
  stream: all,
  demoState: dispatch,
  demoClock: dispatch,
  demoReset: dispatch,
  demoTick: dispatch,
  health: [],
  ready: [],
} as const satisfies Record<ApiRouteName, readonly Actor["role"][]>;
export const matrix = routes.flatMap(([action, route]) =>
  actors.flatMap((actor) =>
    resources.map((scenario) => ({
      action,
      route,
      actor,
      ...scenario,
      allowed:
        route.access !== "public" &&
        (expectedRoles[action] as readonly Actor["role"][]).includes(actor.role) &&
        scenario.owners.includes(actor.role),
    })),
  ),
);
