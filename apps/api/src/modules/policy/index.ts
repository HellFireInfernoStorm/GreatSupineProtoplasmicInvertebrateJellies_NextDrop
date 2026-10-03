// Central authorization (spec/platform/auth.md): deny by default, scoped list queries.
export { can } from "./can";
export { scoped, type Scope } from "./scoped";
export {
  collectionResource,
  publicResource,
  selfResource,
  type Action,
  type Actor,
  type Resource,
  type ResourceResolver,
  type RoutePolicy,
} from "./types";
