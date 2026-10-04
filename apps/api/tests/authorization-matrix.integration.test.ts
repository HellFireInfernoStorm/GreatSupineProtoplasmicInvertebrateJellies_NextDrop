import { randomUUID } from "node:crypto";
import { HUMAN_ROLES, type HumanRole } from "@nextdrop/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CSRF_HEADER, csrfToken, SESSION_COOKIE } from "../src/modules/auth";
import { buildServer, type App } from "../src/server";
import { expectedRoles, routes } from "./support/authorization-cases";
import { createSuiteDatabase, testDatabaseUrl, type SuiteDatabase } from "./support/suite-database";

const secret = "authorization-matrix-secret-authorization-matrix";
const now = new Date("2026-10-03T00:00:00Z");
let suite: SuiteDatabase;
let app: App;
const callers = new Map<HumanRole, { cookie: string; csrf: string; own: string; foreign: string }>();
const REFERENCE_RESPONSES = [
  "outletsResponse",
  "vehiclesResponse",
  "productsResponse",
  "calendarResponse",
  "reasonsResponse",
];
// Generate currently implemented collection paths from the contracts, including store aliases.
const collectionRoutes = routes.filter(([, route]) =>
  [
    "notificationsResponse",
    "readNotificationsResponse",
    "changesResponse",
    "runsResponse",
    "exceptionsResponse",
    ...REFERENCE_RESPONSES,
  ].includes(route.responses[200] ?? ""),
);
// Reference rows each role may see (ADR 0038). The driver has no trips here, so it sees no outlets.
const QUERIES: Record<string, string> = {
  changesResponse: "?after=0",
  calendarResponse: "?from=2026-10-01&to=2026-10-03",
  runsResponse: "?depot=Own%20depot",
  exceptionsResponse: "?depot=Own%20depot",
};
const referenceIds = { ownOutlet: "", foreignOutlet: "", ownVehicle: "", foreignVehicle: "", fresh: "", other: "" };
const visibleReference: Record<string, Record<HumanRole, (keyof typeof referenceIds)[]>> = {
  outletsResponse: { STORE: ["ownOutlet"], DISPATCHER: ["ownOutlet"], LOADER: ["ownOutlet"], DRIVER: [] },
  vehiclesResponse: { STORE: [], DISPATCHER: ["ownVehicle"], LOADER: ["ownVehicle"], DRIVER: ["ownVehicle"] },
  productsResponse: {
    STORE: ["fresh"],
    DISPATCHER: ["fresh", "other"],
    LOADER: ["fresh", "other"],
    DRIVER: ["fresh", "other"],
  },
};

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
    const foreignOutlet = await prisma.outlet.create({
      data: {
        displayId: "MATRIX_FOREIGN_OUTLET",
        brand: "Fresh",
        depot: "Foreign depot",
        districtId: district.id,
        dockType: "rear_dock",
        parkingConstraint: "normal",
        windowOpen: 300,
        windowClose: 600,
      },
    });
    const foreignVehicle = await prisma.vehicle.create({
      data: {
        displayId: "MATRIX_FOREIGN_VEHICLE",
        type: "van",
        temp: "ambient",
        weightCapKg: 1000,
        volumeCapM3: 10,
        fuelType: "diesel",
        kmPerL: 8,
        weeklyFuelQuotaL: 200,
        depot: "Foreign depot",
      },
    });
    for (const [n, v] of [vehicle, foreignVehicle].entries()) {
      await prisma.driver.create({
        data: { displayId: `MATRIX_DRV${n}`, name: "Driver", phone: "0770000000", vehicleId: v.id },
      });
    }
    const product = (sku: string, brand: "Fresh" | "Tech") =>
      prisma.product.create({
        data: {
          sku,
          name: sku,
          brand,
          tempRequirement: "ambient",
          unitLabel: "box",
          unitWeightKg: 1,
          unitVolumeM3: 0.01,
        },
      });
    Object.assign(referenceIds, {
      ownOutlet: outlet.id,
      foreignOutlet: foreignOutlet.id,
      ownVehicle: vehicle.id,
      foreignVehicle: foreignVehicle.id,
      fresh: (await product("MATRIX-FRESH", "Fresh")).id,
      other: (await product("MATRIX-TECH", "Tech")).id,
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
        cookie: session.id,
        csrf: csrfToken(secret, session.id),
        own: own.id,
        foreign: foreign.id,
      });
    }
    await prisma.feedCounter.update({ where: { singleton: true }, data: { head: 4n } });
    await prisma.changeFeed.createMany({
      data: [
        {
          seq: 1n,
          kind: "order_changed",
          entityType: "order",
          entityId: randomUUID(),
          roles: [...HUMAN_ROLES],
          depot: "Own depot",
          outletId: outlet.id,
          vehicleId: vehicle.id,
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
        {
          seq: 3n,
          kind: "order_changed",
          entityType: "order",
          entityId: randomUUID(),
          roles: [...HUMAN_ROLES],
          depot: "Own depot",
          outletId: randomUUID(),
          vehicleId: randomUUID(),
        },
        {
          seq: 4n,
          kind: "order_changed",
          entityType: "order",
          entityId: randomUUID(),
          roles: ["DISPATCHER"],
          depot: "Own depot",
          outletId: outlet.id,
          vehicleId: vehicle.id,
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
    HUMAN_ROLES.flatMap((role) =>
      (route.method === "GET" ? ["collection"] : ["own", "foreign", "all"]).map((scope) => ({
        action,
        route,
        role,
        scope,
      })),
    ),
  );
  it.each(cases)("$action / $role / $scope", async ({ action, route, role, scope }) => {
    const caller = callers.get(role)!;
    const target = scope === "own" ? caller.own : caller.foreign;
    // Use the real guard's sessions.actorFor and real handler query; no parallel hand-built actor.
    await suite.prisma.notification.updateMany({ data: { readAt: null } });
    const response = await app.inject({
      method: route.method,
      url: route.path + (QUERIES[route.responses[200] ?? ""] ?? ""),
      cookies: { [SESSION_COOKIE]: app.signCookie(caller.cookie) },
      headers: { [CSRF_HEADER]: caller.csrf },
      ...(route.method === "POST" ? { payload: scope === "all" ? { all: true } : { all: false, ids: [target] } } : {}),
    });
    if (!(expectedRoles[action] as readonly HumanRole[]).includes(role)) {
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ code: "FORBIDDEN" });
    } else {
      expect(response.statusCode).toBe(200);
      if (route.method === "POST") {
        expect(response.json().updatedCount).toBe(scope === "foreign" ? 0 : 1);
        expect((await suite.prisma.notification.findUniqueOrThrow({ where: { id: caller.own } })).readAt).toEqual(
          scope === "foreign" ? null : now,
        );
        expect(
          (await suite.prisma.notification.findUniqueOrThrow({ where: { id: caller.foreign } })).readAt,
        ).toBeNull();
      } else if (route.responses[200] === "calendarResponse") {
        expect(response.json().items.map((day: { date: string }) => day.date)).toEqual([
          "2026-10-01",
          "2026-10-02",
          "2026-10-03",
        ]);
      } else if (["runsResponse", "exceptionsResponse"].includes(route.responses[200] ?? "")) {
        // The matrix has no trips or exceptions today; the point is who may read the depot.
        expect(Array.isArray(response.json().items)).toBe(true);
      } else if (route.responses[200] === "reasonsResponse") {
        expect(response.json().loadShort.length).toBeGreaterThan(0);
      } else if (visibleReference[route.responses[200] ?? ""]) {
        const expected = visibleReference[route.responses[200]!]![role].map((key) => referenceIds[key]);
        expect(response.json().items.map((item: { id: string }) => item.id)).toEqual(expected);
      } else if (route.responses[200] === "changesResponse") {
        const visible = role === "DISPATCHER" ? ["1", "3", "4"] : role === "LOADER" ? ["1", "3"] : ["1"];
        expect(response.json().items.map((item: { seq: string }) => item.seq)).toEqual(visible);
      } else {
        expect(response.json().items.map((item: { id: string }) => item.id)).toEqual([caller.own]);
        expect(response.json().unreadCount).toBe(1);
      }
    }
  });
});
