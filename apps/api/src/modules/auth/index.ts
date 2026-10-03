// Authentication: login shapes, server-side sessions, CSRF and the global policy guard (spec/platform/auth.md).
import cookie from "@fastify/cookie";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { PrismaClient } from "../../generated/prisma/client";
import type { AuthConfig } from "./config";
import { installGuard, SESSION_COOKIE } from "./guard";
import { createLockout } from "./lockout";
import { authRoutes } from "./routes";
import { createSessions, type SessionRecord } from "./sessions";

export { authConfigFromEnv, type AuthConfig } from "./config";
export { CSRF_HEADER, csrfToken } from "./csrf";
export { assertRoutePolicy, SESSION_COOKIE } from "./guard";
export { hashSecret } from "./secrets";

export interface AuthDependencies {
  prisma: PrismaClient | null;
  config: AuthConfig;
  now: () => Date;
}

/**
 * Register before any route: the guard's hooks apply to routes registered after it, and its onRoute hook
 * rejects a route that declares no policy.
 */
export async function registerAuth(app: FastifyInstance, { prisma, config, now }: AuthDependencies): Promise<void> {
  await app.register(cookie, { secret: config.sessionSecret });
  const sessions = prisma ? createSessions(prisma, config, now) : null;
  const lockout = createLockout(config.lockout, () => now().getTime());
  const setSessionCookie = (reply: FastifyReply, session: SessionRecord) => {
    reply.setCookie(SESSION_COOKIE, session.id, {
      signed: true,
      httpOnly: true,
      sameSite: "lax",
      secure: config.secureCookie,
      path: "/api",
      maxAge: sessions!.cookieMaxAgeSeconds(session),
    });
  };
  const clearSessionCookie = (reply: FastifyReply) => {
    reply.clearCookie(SESSION_COOKIE, { path: "/api", httpOnly: true, sameSite: "lax", secure: config.secureCookie });
  };
  installGuard(app, { sessions, config, now, setSessionCookie, clearSessionCookie });
  await app.register(authRoutes, { prisma, sessions, config, now, lockout, setSessionCookie, clearSessionCookie });
}
