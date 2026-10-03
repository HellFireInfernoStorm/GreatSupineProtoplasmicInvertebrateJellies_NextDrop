import { randomUUID } from "node:crypto";
import { HUMAN_ROLES, type HumanRole } from "@nextdrop/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CSRF_HEADER, csrfToken, SESSION_COOKIE } from "../src/modules/auth";
import { scoped, type Actor } from "../src/modules/policy";
import { buildServer, type App } from "../src/server";
import { routes } from "./support/authorization-cases";
import { createSuiteDatabase, testDatabaseUrl, type SuiteDatabase } from "./support/suite-database";

const secret = "authorization-matrix-secret-authorization-matrix";
const now = new Date("2026-10-03T00:00:00Z");
let suite: SuiteDatabase;
let app: App;
const callers = new Map<HumanRole, { actor: Actor; cookie: string; csrf: string; own: string; foreign: string }>();
// Generate currently implemented collection paths from the contracts, including store aliases.
const collectionRoutes = routes.filter(([, route]) =>
  ["notificationsResponse", "readNotificationsResponse", "changesResponse"].includes(route.responses[200] ?? ""),
);

describe.skipIf(!testDatabaseUrl)("generated collection matrix (PostgreSQL and real handlers)", () => {
  beforeAll(async () => {
    suite = await createSuiteDatabase("authorization_matrix");
    const prisma = suite.prisma;
    const district = await prisma.district.create({
      data: {
        name: "Matrix district",
        depot: "Own depot",
        roadClass: "urban",
        freeFlowKmh: 40,
        depotToDistrictKm: 10,
        depotToDistrictFreeflowMin: 15,
        interStopKm: 1,
        interStopFreeflowMin: 3,
      },
    });
    const outlet = await prisma.outlet.create({
      data: {
        displayId: "MATRIX_OUTLET",
        brand: "Fresh",
        depot: "Own depot",
        districtId: district.id,
        dockType: "rear_dock",
        parkingConstraint: "normal",
        windowOpen: 300,
        windowClose: 600,
      },
    });
    const vehicle = await prisma.vehicle.create({
      data: {
        displayId: "MATRIX_VEHICLE",
        type: "van",
        temp: "reefer",
        weightCapKg: 1000,
        volumeCapM3: 10,
        fuelType: "diesel",
        kmPerL: 8,
        weeklyFuelQuotaL: 200,
        depot: "Own depot",
      },
    });
    const otherUser = await prisma.user.create({
      data: {
        loginId: "foreign",
        role: "DISPATCHER",
        displayName: "Foreign",
        passwordHash: "unused",
        depot: "Foreign depot",
      },
    });
    for (const role of HUMAN_ROLES) {
      const user = await prisma.user.create({
        data: {
          loginId: role,
          role,
          displayName: role,
          passwordHash: "unused",
          depot: "Own depot",
          ...(role === "STORE" ? { outletId: outlet.id } : {}),
          ...(role === "DRIVER" ? { vehicleId: vehicle.id } : {}),
        },
      });
      const session = await prisma.session.create({
        data: {
          userId: user.id,
          kind: role === "LOADER" || role === "DRIVER" ? "FIELD" : "WEB",
          expiresAt: new Date(now.getTime() + 3_600_000),
        },
      });
      const base = { userId: user.id, sessionId: session.id };
      const actor: Actor =
        role === "STORE"
          ? { ...base, role, outletId: outlet.id, depot: "Own depot" }
          : role === "DISPATCHER"
            ? { ...base, role, depots: ["Own depot"] }
            : role === "LOADER"
              ? { ...base, role, depot: "Own depot", deviceId: null }
              : { ...base, role, vehicleId: vehicle.id, depot: "Own depot", deviceId: null };
      const notification = (userId: string) =>
        prisma.notification.create({
          data: {
            userId,
            kind: "plan_published",
            titleKey: "notifications.planPublished",
            params: {},
            entityRef: { type: "order", id: randomUUID() },
          },
        });
      const own = await notification(user.id);
      const foreign = await notification(otherUser.id);
      callers.set(role, {
        actor,
        cookie: session.id,
        csrf: csrfToken(secret, session.id),
        own: own.id,
        foreign: foreign.id,
      });
    }
    await prisma.feedCounter.update({ where: { singleton: true }, data: { head: 2n } });
    const store = callers.get("STORE")!.actor;
    const driver = callers.get("DRIVER")!.actor;
    if (store.role !== "STORE" || driver.role !== "DRIVER") throw new Error("Incorrect fixture roles");
    await prisma.changeFeed.createMany({
      data: [
        {
          seq: 1n,
          kind: "order_changed",
          entityType: "order",
          entityId: randomUUID(),
          roles: [...HUMAN_ROLES],
          depot: "Own depot",
          outletId: store.outletId,
          vehicleId: driver.vehicleId,
        },
        {
          seq: 2n,
          kind: "order_changed",
          entityType: "order",
          entityId: randomUUID(),
          roles: [...HUMAN_ROLES],
          depot: "Foreign depot",
          outletId: randomUUID(),
          vehicleId: randomUUID(),
        },
      ],
    });
    app = await buildServer({}, { database: suite.appDatabase, auth: { sessionSecret: secret }, now: () => now });
    await app.ready();
  });
  afterAll(async () => {
    await app?.close();
    await suite?.drop();
  });

  const cases = collectionRoutes.flatMap(([action, route]) =>
    HUMAN_ROLES.flatMap((role) => ["own", "foreign"].map((scope) => ({ action, route, role, scope }))),
  );
  it.each(cases)("$action / $role / $scope", async ({ route, role, scope }) => {
    const caller = callers.get(role)!;
    const target = scope === "own" ? caller.own : caller.foreign;
    // Independent expected IDs prove query predicates, not just the shape of Prisma where objects.
    if (route.responses[200] === "changesResponse") {
      const rows = await suite.prisma.changeFeed.findMany({
        where: { AND: [scoped(caller.actor).changeFeed, { seq: scope === "own" ? 1n : 2n }] },
      });
      expect(rows.map((row) => row.seq)).toEqual(scope === "own" ? [1n] : []);
    } else {
      const rows = await suite.prisma.notification.findMany({
        where: { AND: [scoped(caller.actor).notifications, { id: target }] },
      });
      expect(rows.map((row) => row.id)).toEqual(scope === "own" ? [target] : []);
    }
    await suite.prisma.notification.updateMany({ data: { readAt: null } });
    const response = await app.inject({
      method: route.method,
      url: route.path + (route.responses[200] === "changesResponse" ? "?after=0" : ""),
      cookies: { [SESSION_COOKIE]: app.signCookie(caller.cookie) },
      headers: { [CSRF_HEADER]: caller.csrf },
      ...(route.method === "POST" ? { payload: { all: false, ids: [target] } } : {}),
    });
    if (!route.roles.includes(role)) {
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ code: "FORBIDDEN" });
    } else {
      expect(response.statusCode).toBe(200);
      if (route.method === "POST") {
        expect(response.json().updatedCount).toBe(scope === "own" ? 1 : 0);
        expect(
          (await suite.prisma.notification.findUniqueOrThrow({ where: { id: caller.foreign } })).readAt,
        ).toBeNull();
      } else if (route.responses[200] === "changesResponse") {
        expect(response.json().items.map((item: { seq: string }) => item.seq)).toEqual(["1"]);
      } else {
        expect(response.json().items.map((item: { id: string }) => item.id)).toEqual([caller.own]);
      }
    }
  });
});
