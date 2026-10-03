import {
  ackResponseSchema,
  loginRequestSchema,
  mutationHeadersSchema,
  reauthRequestSchema,
  sessionResponseSchema,
  type LoginRequest,
} from "@nextdrop/contracts";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { z } from "zod";
import type { PrismaClient } from "../../generated/prisma/client";
import { invalidCredentials, rateLimited, unauthenticated } from "../../lib/errors";
import { publicResource, selfResource, type Actor } from "../policy";
import type { AuthConfig } from "./config";
import { csrfToken } from "./csrf";
import type { GuardDependencies } from "./guard";
import type { Lockout } from "./lockout";
import { verifySecret } from "./secrets";
import type { AccountRecord, SessionRecord, Sessions } from "./sessions";

type SessionResponse = z.infer<typeof sessionResponseSchema>;

export interface AuthRouteDependencies {
  prisma: PrismaClient | null;
  sessions: Sessions | null;
  config: AuthConfig;
  now: () => Date;
  lockout: Lockout;
  setSessionCookie: GuardDependencies["setSessionCookie"];
  clearSessionCookie: GuardDependencies["clearSessionCookie"];
}

const accountInclude = { outlet: { select: { depot: true } }, vehicle: { select: { depot: true } } } as const;

function loginKey(body: LoginRequest): string {
  return body.role === "DISPATCHER" ? body.email : body.loginId;
}

/** Find the account for each login shape (spec/platform/api-dtos.md). Login IDs and emails ignore case. */
function findAccount(prisma: PrismaClient, body: LoginRequest): Promise<AccountRecord | null> {
  const insensitive = (value: string) => ({ equals: value, mode: "insensitive" as const });
  switch (body.role) {
    case "STORE":
      return prisma.user.findFirst({
        where: {
          role: "STORE",
          OR: body.loginId.includes("@")
            ? [{ loginId: insensitive(body.loginId) }]
            : [{ loginId: insensitive(body.loginId) }, { outlet: { displayId: body.loginId } }],
        },
        include: accountInclude,
        orderBy: { id: "asc" },
      });
    case "DISPATCHER":
      return prisma.user.findFirst({
        where: { role: "DISPATCHER", loginId: insensitive(body.email) },
        include: accountInclude,
      });
    case "LOADER":
    case "DRIVER":
      return prisma.user.findFirst({ where: { role: body.role, loginId: body.loginId }, include: accountInclude });
  }
}

/** `POST /auth/login`, `GET /auth/me`, `POST /auth/logout`, `POST /auth/reauth`. */
export const authRoutes: FastifyPluginAsyncZod<AuthRouteDependencies> = async (app, deps) => {
  const { config, now, lockout } = deps;
  const rateLimit = { max: config.loginRateLimit.max, timeWindow: config.loginRateLimit.timeWindowMs };

  function respond(session: SessionRecord, actor: Actor): SessionResponse {
    return {
      user: deps.sessions!.sessionUser(session.user, actor),
      expiresAt: session.expiresAt.toISOString(),
      serverTime: now().toISOString(),
      csrfToken: csrfToken(config.sessionSecret, session.id),
    };
  }

  app.post(
    "/api/auth/login",
    {
      schema: { headers: mutationHeadersSchema, body: loginRequestSchema, response: { 200: sessionResponseSchema } },
      config: { policy: { action: "login", resourceResolver: publicResource }, rateLimit },
    },
    async (request, reply) => {
      const { prisma, sessions } = deps;
      if (!prisma || !sessions) throw new Error("Login needs a database");
      const body = request.body;
      const account = await findAccount(prisma, body);
      // One counter per account, whichever login ID reached it; unknown IDs are counted by what was typed.
      const key = account ? `login:user:${account.id}` : `login:${body.role}:${loginKey(body).toLowerCase()}`;
      const wait = lockout.retryAfterMs(key);
      if (wait > 0) throw rateLimited(wait);

      const secret = body.role === "STORE" || body.role === "DISPATCHER" ? body.password : body.pin;
      const verified = await verifySecret(account?.passwordHash ?? null, secret);
      const deviceId = body.role === "LOADER" || body.role === "DRIVER" ? body.deviceId : null;
      let actor = verified && account ? await sessions.actorFor(account, "", deviceId) : null;
      if (actor?.role === "DISPATCHER" && body.role === "DISPATCHER" && !actor.depots.includes(body.depot))
        actor = null;
      if (!account || !actor) {
        if (verified && account) request.log.warn({ userId: account.id }, "login refused: account scope or depot");
        lockout.fail(key);
        throw invalidCredentials();
      }
      lockout.succeed(key);

      if (deviceId) {
        const seenAt = now();
        await prisma.device.upsert({
          where: { id: deviceId },
          create: { id: deviceId, userId: account.id, kind: "FIELD", appVersion: "unknown", lastSeenAt: seenAt },
          update: { userId: account.id, kind: "FIELD", lastSeenAt: seenAt },
        });
      }
      const session = await sessions.create({ userId: account.id, kind: deviceId ? "FIELD" : "WEB", deviceId });
      deps.setSessionCookie(reply, session);
      return respond(session, { ...actor, sessionId: session.id });
    },
  );

  app.get(
    "/api/auth/me",
    {
      schema: { response: { 200: sessionResponseSchema } },
      config: { policy: { action: "me", resourceResolver: selfResource } },
    },
    async (request) => respond(request.authSession!, request.actor!),
  );

  app.post(
    "/api/auth/logout",
    {
      schema: { headers: mutationHeadersSchema, response: { 200: ackResponseSchema } },
      config: { policy: { action: "logout", resourceResolver: selfResource } },
    },
    async (request, reply) => {
      await deps.sessions!.remove(request.authSession!.id);
      deps.clearSessionCookie(reply);
      return { ok: true as const, serverTime: now().toISOString() };
    },
  );

  // ADR 0024: renew a retained FIELD session by PIN, without a full login and without touching the outbox.
  app.post(
    "/api/auth/reauth",
    {
      schema: { headers: mutationHeadersSchema, body: reauthRequestSchema, response: { 200: sessionResponseSchema } },
      config: { policy: { action: "reauth", resourceResolver: selfResource }, rateLimit },
    },
    async (request, reply) => {
      const sessions = deps.sessions!;
      const session = request.authSession!;
      const { role, pin, deviceId } = request.body;
      if (session.kind !== "FIELD" || session.deviceId !== deviceId || session.user.role !== role) {
        throw unauthenticated("errors.reauthIdentity");
      }
      if (now().getTime() >= sessions.reauthDeadline(session)) {
        await sessions.remove(session.id);
        deps.clearSessionCookie(reply);
        throw unauthenticated("errors.sessionExpired");
      }
      const key = `reauth:${session.id}`;
      const wait = lockout.retryAfterMs(key);
      if (wait > 0) throw rateLimited(wait);
      if (!(await verifySecret(session.user.passwordHash, pin))) {
        lockout.fail(key);
        throw invalidCredentials();
      }
      lockout.succeed(key);
      const renewed = await sessions.slide(session, true);
      deps.setSessionCookie(reply, renewed);
      return respond(renewed, request.actor!);
    },
  );
};
