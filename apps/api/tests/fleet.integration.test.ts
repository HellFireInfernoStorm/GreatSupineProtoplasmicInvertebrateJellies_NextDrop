// Fleet write contract, real authorization and transaction invariants (issue #63, ADR 0017).
import { apiRoutes, fleetResponseSchema, HUMAN_ROLES, type ApiDto, type HumanRole } from "@nextdrop/contracts";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_PASSWORD, DEMO_PIN, DISPATCHER_LOGIN_ID } from "../prisma/seed/accounts";
import { runSeed } from "../prisma/seed/index";
import { CSRF_HEADER, csrfToken, SESSION_COOKIE } from "../src/modules/auth";
import { buildServer, type App } from "../src/server";
import { createSuiteDatabase, testDatabaseUrl, type SuiteDatabase } from "./support/suite-database";

const DATE = "2026-09-29";
const now = new Date("2026-09-28T11:00:00.000Z");
const offset = 3600000;
const at = new Date(now.getTime() + offset);
const secret = "fleet-integration-secret-fleet-integration";
type Session = { cookie: string; csrf: string };
if (!testDatabaseUrl) console.info("Skipping fleet tests: set TEST_DATABASE_URL to a disposable _test database.");

describe.skipIf(!testDatabaseUrl)("fleet commands (PostgreSQL)", () => {
  let suite: SuiteDatabase;
  let app: App;
  const sessions = new Map<HumanRole, Session>();
  let restricted: Session;
  let ownVehicle: string;
  let foreignVehicle: string;
  const command = (session: Session | undefined, changes: ApiDto<"updateFleetRequest">["changes"], csrf = true) =>
    app.inject({
      method: apiRoutes.updateFleet.method,
      url: apiRoutes.updateFleet.path,
      ...(session ? { cookies: { [SESSION_COOKIE]: session.cookie } } : {}),
      headers: csrf && session ? { [CSRF_HEADER]: session.csrf } : {},
      payload: { changes },
    });
  const change = (vehicleId = ownVehicle, status: "AVAILABLE" | "IN_WORKSHOP" = "IN_WORKSHOP") => ({
    vehicleId,
    date: DATE,
    status,
    reason: "BREAKDOWN" as const,
    note: "Engine fault",
  });
  const totals = async () => ({
    events: await suite.prisma.orderEvent.count({ where: { type: "VEHICLE_AVAILABILITY_CHANGED" } }),
    feed: (await suite.prisma.feedCounter.findUniqueOrThrow({ where: { singleton: true } })).head,
    availability: await suite.prisma.vehicleAvailability.count(),
  });

  beforeAll(async () => {
    suite = await createSuiteDatabase("issue63fleet");
    await runSeed(suite.prisma);
    // Demonstrate business timestamps follow the stored demo offset rather than the real/security clock.
    await suite.prisma.demoState.update({ where: { singleton: true }, data: { clockOffsetMs: BigInt(offset) } });
    app = await buildServer(
      {},
      { database: suite.appDatabase, auth: { sessionSecret: secret, demoMode: true }, now: () => now },
    );
    await app.ready();
    ownVehicle = (await suite.prisma.vehicle.findUniqueOrThrow({ where: { displayId: "VEH002" } })).id;
    foreignVehicle = (await suite.prisma.vehicle.findUniqueOrThrow({ where: { displayId: "VEH039" } })).id;
    const logins: Record<HumanRole, object> = {
      DISPATCHER: { role: "DISPATCHER", email: DISPATCHER_LOGIN_ID, password: DEMO_PASSWORD, depot: "Peliyagoda" },
      STORE: { role: "STORE", loginId: "OUT004", password: DEMO_PASSWORD },
      LOADER: { role: "LOADER", loginId: "LDR001", pin: DEMO_PIN, deviceId: randomUUID() },
      DRIVER: { role: "DRIVER", loginId: "DRV039", pin: DEMO_PIN, deviceId: randomUUID() },
    };
    for (const role of HUMAN_ROLES) {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        headers: { [CSRF_HEADER]: "1" },
        payload: logins[role],
      });
      expect(res.statusCode, res.body).toBe(200);
      sessions.set(role, {
        cookie: res.cookies.find((c) => c.name === SESSION_COOKIE)!.value,
        csrf: res.json().csrfToken,
      });
    }
    const user = await suite.prisma.user.create({
      data: {
        loginId: "fleet-only",
        role: "DISPATCHER",
        displayName: "Fleet dispatcher",
        depot: "Peliyagoda",
        passwordHash: "unused",
      },
    });
    const session = await suite.prisma.session.create({
      data: { userId: user.id, kind: "WEB", expiresAt: new Date(now.getTime() + 3600000) },
    });
    restricted = { cookie: app.signCookie(session.id), csrf: csrfToken(secret, session.id) };
  }, 120000);
  afterAll(async () => {
    await app?.close();
    await suite?.drop();
  });

  it.each(HUMAN_ROLES)("enforces the contracts updateFleet role matrix: %s", async (role) => {
    const before = await totals();
    const res = await command(sessions.get(role), [change(ownVehicle, "AVAILABLE")]);
    const allowed = (apiRoutes.updateFleet.roles as readonly HumanRole[]).includes(role);
    expect(res.statusCode, res.body).toBe(allowed ? 200 : 403);
    if (allowed) fleetResponseSchema.parse(res.json());
    else expect(await totals()).toEqual(before);
  });

  it("requires an authenticated dispatcher and its CSRF token", async () => {
    expect((await command(undefined, [change()])).statusCode).toBe(401);
    expect((await command(restricted, [change()], false)).statusCode).toBe(403);
  });

  it("writes one vehicle event, projection and scoped hint at the server clock, with idempotent retries", async () => {
    const before = await totals();
    const res = await command(restricted, [change()]);
    expect(res.statusCode, res.body).toBe(200);
    const body = fleetResponseSchema.parse(res.json());
    expect(body.items.every((row) => row.vehicle.depot === "Peliyagoda")).toBe(true);
    expect(body.items.find((row) => row.vehicle.id === ownVehicle)!.availability).toEqual({
      status: "IN_WORKSHOP",
      reason: "BREAKDOWN",
      note: "Engine fault",
      changedAt: at.toISOString(),
    });
    const event = await suite.prisma.orderEvent.findFirstOrThrow({
      where: { type: "VEHICLE_AVAILABILITY_CHANGED", vehicleId: ownVehicle },
      orderBy: { id: "desc" },
    });
    expect(event).toMatchObject({
      orderId: null,
      tripId: null,
      source: "SERVER",
      actorRole: "DISPATCHER",
      disposition: "APPLIED",
      payload: change(),
      capturedAt: at,
      receivedAt: at,
    });
    const feed = await suite.prisma.changeFeed.findFirstOrThrow({
      where: { seq: { gt: before.feed }, kind: "availability_changed" },
    });
    expect(feed).toMatchObject({
      entityType: "vehicle",
      entityId: ownVehicle,
      depot: "Peliyagoda",
      vehicleId: ownVehicle,
      roles: ["DISPATCHER", "LOADER", "DRIVER"],
    });
    const written = await totals();
    expect(written.events).toBe(before.events + 1);
    expect(written.feed).toBe(before.feed + 1n);
    expect((await command(restricted, [change()])).statusCode).toBe(200);
    expect(await totals()).toEqual(written);
    const read = await app.inject({
      method: "GET",
      url: `/api/dispatch/fleet?date=${DATE}`,
      cookies: { [SESSION_COOKIE]: restricted.cookie },
    });
    expect(read.json()).toEqual(body);
  });

  it("rolls back the whole batch for a foreign depot or missing vehicle", async () => {
    for (const id of [foreignVehicle, randomUUID()]) {
      const before = await totals();
      const res = await command(restricted, [change(ownVehicle, "AVAILABLE"), change(id)]);
      expect(res.statusCode, res.body).toBe(id === foreignVehicle ? 403 : 404);
      expect(await totals()).toEqual(before);
      expect(
        (
          await suite.prisma.vehicleAvailability.findUniqueOrThrow({
            where: { vehicleId_date: { vehicleId: ownVehicle, date: new Date(`${DATE}T00:00:00Z`) } },
          })
        ).status,
      ).toBe("IN_WORKSHOP");
    }
  });

  it("supports service days, returning to availability and atomically updating more than one date", async () => {
    const tomorrow = "2026-09-30";
    const changes = [
      { ...change(ownVehicle, "AVAILABLE"), note: "Repaired" },
      { vehicleId: ownVehicle, date: tomorrow, status: "IN_WORKSHOP" as const, reason: "SERVICE" as const },
    ];
    const before = await totals();
    const res = await command(restricted, changes);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().date).toBe(DATE);
    expect(
      res.json().items.find((row: ApiDto<"fleetResponse">["items"][number]) => row.vehicle.id === ownVehicle)
        .availability.status,
    ).toBe("AVAILABLE");
    expect((await totals()).events).toBe(before.events + 2);
    expect((await totals()).feed).toBe(before.feed + 2n);
    const read = await app.inject({
      method: "GET",
      url: `/api/dispatch/fleet?date=${tomorrow}`,
      cookies: { [SESSION_COOKIE]: restricted.cookie },
    });
    expect(
      read.json().items.find((row: ApiDto<"fleetResponse">["items"][number]) => row.vehicle.id === ownVehicle)
        .availability,
    ).toEqual({ status: "IN_WORKSHOP", reason: "SERVICE", note: null, changedAt: at.toISOString() });
  });

  it("serializes concurrent identical updates without duplicate events", async () => {
    const before = await totals();
    const responses = await Promise.all([command(restricted, [change()]), command(restricted, [change()])]);
    expect(responses.map((response) => response.statusCode)).toEqual([200, 200]);
    expect((await totals()).events).toBe(before.events + 1);
    expect((await totals()).feed).toBe(before.feed + 1n);
  });

  it("feeds workshop availability into the existing validator and allocator", async () => {
    const path = `/api/dispatch/days/${DATE}`;
    const call = (suffix: string, payload: object) =>
      app.inject({
        method: "POST",
        url: `${path}/${suffix}?depot=Peliyagoda`,
        cookies: { [SESSION_COOKIE]: restricted.cookie },
        headers: { [CSRF_HEADER]: restricted.csrf },
        payload,
      });
    const proposed = await call("propose", { revision: 0 });
    expect(proposed.statusCode, proposed.body).toBe(200);
    const draft = (proposed.json() as ApiDto<"proposeResponse">).draft;
    expect(draft.data.trips.some((trip) => trip.vehicleId === ownVehicle)).toBe(false);
    const assignedVehicle = draft.data.trips[0]!.vehicleId;
    expect((await command(restricted, [change(assignedVehicle)])).statusCode).toBe(200);
    const validation = await call("validate", { data: draft.data });
    expect(validation.statusCode, validation.body).toBe(200);
    expect(validation.json().ok).toBe(false);
    expect(validation.json().violations.map((violation: { code: string }) => violation.code)).toContain(
      "VEHICLE_UNAVAILABLE",
    );
    const next = await call("propose", { revision: draft.revision });
    expect(next.statusCode, next.body).toBe(200);
    expect(
      (next.json() as ApiDto<"proposeResponse">).draft.data.trips.some((trip) => trip.vehicleId === assignedVehicle),
    ).toBe(false);
    expect(await suite.prisma.planVersion.count()).toBe(0);
  });

  it("rolls back the projection and audit event if the final feed append fails", async () => {
    const before = await totals();
    const existing = await suite.prisma.vehicleAvailability.findUniqueOrThrow({
      where: { vehicleId_date: { vehicleId: ownVehicle, date: new Date(`${DATE}T00:00:00Z`) } },
    });
    await suite.prisma.feedCounter.update({ where: { singleton: true }, data: { head: 9223372036854775807n } });
    try {
      const response = await command(restricted, [{ ...change(), note: "Must roll back" }]);
      expect(response.statusCode).toBe(500);
      expect(await suite.prisma.orderEvent.count({ where: { type: "VEHICLE_AVAILABILITY_CHANGED" } })).toBe(
        before.events,
      );
      expect(await suite.prisma.vehicleAvailability.findUniqueOrThrow({ where: { id: existing.id } })).toEqual(
        existing,
      );
      expect(await suite.prisma.changeFeed.count({ where: { seq: { gt: before.feed } } })).toBe(0);
    } finally {
      await suite.prisma.feedCounter.update({ where: { singleton: true }, data: { head: before.feed } });
    }
  });

  it("rejects unknown/server-owned fields and invalid availability before writing", async () => {
    for (const payload of [
      { changes: [] },
      { changes: [{ ...change(), sourceEventId: randomUUID() }] },
      { changes: [{ ...change(), status: "BROKEN" }] },
    ]) {
      const before = await totals();
      const res = await app.inject({
        method: "PUT",
        url: apiRoutes.updateFleet.path,
        cookies: { [SESSION_COOKIE]: restricted.cookie },
        headers: { [CSRF_HEADER]: restricted.csrf },
        payload,
      });
      expect(res.statusCode, res.body).toBe(400);
      expect(await totals()).toEqual(before);
    }
  });
});
