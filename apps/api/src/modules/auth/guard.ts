import { apiRoutes, DEMO_SCRIPT_KEY_HEADER } from "@nextdrop/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest, RouteOptions } from "fastify";
import { forbidden, notFound, unauthenticated } from "../../lib/errors";
import { can, type Actor } from "../policy";
import type { AuthConfig } from "./config";
import { CSRF_HEADER, csrfToken, headerValue, safeEqual } from "./csrf";
import type { SessionRecord, Sessions } from "./sessions";

export const SESSION_COOKIE = "nextdrop_session";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

declare module "fastify" {
  interface FastifyRequest {
    /** Set by the guard for session, expired-session and session-based demo access. */
    actor: Actor | null;
    authSession: SessionRecord | null;
    /** Demo access granted by DEMO_SCRIPT_KEY rather than a session. */
    scriptKeyAccess: boolean;
  }
}

/** Registration-time check: every route declares a policy whose action matches its contract method and path. */
export function assertRoutePolicy(route: Pick<RouteOptions, "method" | "url" | "config">): void {
  const methods = [route.method].flat();
  const label = `${methods.join(",")} ${route.url}`;
  const policy = route.config?.policy;
  if (!policy) throw new Error(`Route ${label} declares no policy: add config.policy { action, resourceResolver }`);
  if (!Object.hasOwn(apiRoutes, policy.action)) throw new Error(`Route ${label}: unknown action ${policy.action}`);
  if (typeof policy.resourceResolver !== "function") throw new Error(`Route ${label}: resourceResolver is missing`);
  const contract = apiRoutes[policy.action];
  const methodMatches = methods.every((m) => m === contract.method || (m === "HEAD" && contract.method === "GET"));
  if (!methodMatches || route.url !== contract.path) {
    throw new Error(`Route ${label} does not match action ${policy.action} (${contract.method} ${contract.path})`);
  }
}

export interface GuardDependencies {
  sessions: Sessions | null;
  config: AuthConfig;
  now: () => Date;
  setSessionCookie: (reply: FastifyReply, session: SessionRecord) => void;
  clearSessionCookie: (reply: FastifyReply) => void;
}

/**
 * Global hooks. onRequest authenticates and checks CSRF before validation; preHandler resolves the declared
 * resource after validation and calls `can()`. Any route without a policy is refused.
 */
export function installGuard(app: FastifyInstance, deps: GuardDependencies): void {
  const { sessions, config, now } = deps;
  app.decorateRequest("actor", null);
  app.decorateRequest("authSession", null);
  app.decorateRequest("scriptKeyAccess", false);
  app.addHook("onRoute", assertRoutePolicy);

  async function readSession(request: FastifyRequest): Promise<SessionRecord | null> {
    const raw = request.cookies[SESSION_COOKIE];
    if (!raw || !sessions) return null;
    const unsigned = request.unsignCookie(raw);
    if (!unsigned.valid || !unsigned.value || !UUID.test(unsigned.value)) return null;
    return sessions.find(unsigned.value);
  }

  function scriptKeyMatches(request: FastifyRequest): boolean {
    const key = headerValue(request.headers[DEMO_SCRIPT_KEY_HEADER]);
    return config.demoScriptKey !== "" && key !== "" && safeEqual(key, config.demoScriptKey);
  }

  app.addHook("onRequest", async (request, reply) => {
    const policy = request.routeOptions.config.policy;
    if (!policy) {
      if (request.is404) return;
      throw forbidden();
    }
    const access = apiRoutes[policy.action].access;
    const mutation = !SAFE_METHODS.has(request.method);
    if (access === "public") {
      // No session yet: the custom header alone is the CSRF defence for login.
      if (mutation && headerValue(request.headers[CSRF_HEADER]) === "") throw forbidden("errors.csrfMissing");
      return;
    }
    if (access === "demo") {
      if (!config.demoMode) throw notFound();
      if (scriptKeyMatches(request)) {
        request.scriptKeyAccess = true;
        return;
      }
    }

    const session = await readSession(request);
    if (!session || !sessions) throw unauthenticated();
    const expired = session.expiresAt.getTime() <= now().getTime();
    if (expired && access !== "expired-session") {
      // Keep FIELD rows through the reauth grace window (ADR 0024); expired WEB rows are useless.
      if (session.kind === "WEB" || now().getTime() >= sessions.reauthDeadline(session)) {
        await sessions.remove(session.id);
        deps.clearSessionCookie(reply);
      }
      throw unauthenticated("errors.sessionExpired");
    }
    if (
      mutation &&
      !safeEqual(headerValue(request.headers[CSRF_HEADER]), csrfToken(config.sessionSecret, session.id))
    ) {
      throw forbidden("errors.csrfInvalid");
    }
    const actor = await sessions.actorFor(session.user, session.id, session.deviceId);
    if (!actor) throw unauthenticated();
    request.actor = actor;
    request.authSession = session;
    if (access !== "expired-session") {
      const slid = await sessions.slide(session);
      if (slid !== session) {
        request.authSession = slid;
        deps.setSessionCookie(reply, slid);
      }
    }
  });

  app.addHook("preHandler", async (request) => {
    const policy = request.routeOptions.config.policy;
    if (!policy) {
      if (request.is404) return;
      throw forbidden();
    }
    if (apiRoutes[policy.action].access === "public" || request.scriptKeyAccess) return;
    const resource = await policy.resourceResolver(request);
    if (!can(request.actor, policy.action, resource)) throw forbidden();
  });
}
