import type { ApiRouteName } from "@nextdrop/contracts";
import type { FastifyRequest } from "fastify";

/** The authenticated caller. Built from a Session row by the auth module (spec/platform/auth.md). */
export type Actor =
  | { role: "STORE"; userId: string; sessionId: string; outletId: string; depot: string }
  | { role: "DISPATCHER"; userId: string; sessionId: string; depots: readonly string[] }
  | { role: "LOADER"; userId: string; sessionId: string; depot: string; deviceId: string | null }
  | { role: "DRIVER"; userId: string; sessionId: string; vehicleId: string; depot: string; deviceId: string | null };

/** Policy actions are the contracts route table's operation names, so the role ceiling has one source. */
export type Action = ApiRouteName;

/** What a route touches, in ownership terms. Resolvers load the identifying columns, never whole rows. */
export type Resource =
  /** The caller's own session or identity (auth/me, logout, reauth). */
  | { kind: "self" }
  /** A list endpoint. Rows must come from `scoped(actor)`. */
  | { kind: "collection" }
  | { kind: "depot"; depot: string }
  | { kind: "outlet"; outletId: string; depot: string }
  /** `vehicleIds`: vehicles whose trips carry this order. */
  | { kind: "order"; outletId: string; depot: string; vehicleIds: readonly string[] }
  /** `outletIds`: outlets with a stop on this trip. */
  | { kind: "trip"; depot: string; vehicleId: string; outletIds: readonly string[] }
  | { kind: "vehicle"; vehicleId: string; depot: string }
  /**
   * A photo or signature, through the event that references it. Readers: the depot's dispatcher, the outlet's store,
   * and the user who recorded the event. Null fields match nobody (an unlinked blob is unreadable).
   */
  | { kind: "blob"; depot: string | null; outletId: string | null; uploaderUserId: string | null };

/** Resolve the resource after request validation. Throw `notFound()` when it does not exist. */
export type ResourceResolver = (request: FastifyRequest) => Resource | Promise<Resource>;

/** Every route declares this as `config.policy`. Registration fails without it. */
export interface RoutePolicy {
  action: Action;
  resourceResolver: ResourceResolver;
}

export const selfResource: ResourceResolver = () => ({ kind: "self" });
export const collectionResource: ResourceResolver = () => ({ kind: "collection" });
/** For `access: public` routes, where `can()` is not consulted. */
export const publicResource: ResourceResolver = () => ({ kind: "self" });

declare module "fastify" {
  interface FastifyContextConfig {
    policy?: RoutePolicy;
  }
}
