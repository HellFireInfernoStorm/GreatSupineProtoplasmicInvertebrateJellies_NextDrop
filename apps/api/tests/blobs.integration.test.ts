import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "../src/generated/prisma/client";
import { CSRF_HEADER, hashSecret, SESSION_COOKIE } from "../src/modules/auth";
import { buildServer, type App } from "../src/server";
import { createSuiteDatabase, testDatabaseUrl, type SuiteDatabase } from "./support/suite-database";

if (!testDatabaseUrl)
  console.info("Skipping blob integration tests: set TEST_DATABASE_URL to a disposable _test database.");

const PIN = "2468";
const PASSWORD = "demo-password";
const clock = new Date("2026-10-04T01:00:00.000Z");
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const ids = {} as Record<"outlet" | "otherOutlet" | "vehicle" | "order" | "dispatcher", string>;

type Who = "sampath" | "ruwan" | "store" | "otherStore" | "nimal" | "colombo";

async function seed(prisma: PrismaClient) {
  const district = await prisma.district.create({
    data: {
      name: "Kandy",
      depot: "Kandy",
      roadClass: "hill",
      freeFlowKmh: 30,
      depotToDistrictKm: 10,
      depotToDistrictFreeflowMin: 20,
      interStopKm: 2,
      interStopFreeflowMin: 5,
    },
  });
  const outlet = async (displayId: string) =>
    (
      await prisma.outlet.create({
        data: {
          displayId,
          brand: "Fresh",
          depot: "Kandy",
          dockType: "rear_dock",
          parkingConstraint: "normal",
          windowOpen: 300,
          windowClose: 480,
          districtId: district.id,
        },
      })
    ).id;
  ids.outlet = await outlet("OUT108");
  ids.otherOutlet = await outlet("OUT105");
  const vehicle = async (displayId: string, depot: string) =>
    (
      await prisma.vehicle.create({
        data: {
          displayId,
          type: "truck",
          temp: "reefer",
          weightCapKg: 3000,
          volumeCapM3: 20,
          fuelType: "diesel",
          kmPerL: 6,
          weeklyFuelQuotaL: 300,
          depot,
          driver_vehicleId: {
            create: { displayId: `DRV${displayId.slice(3)}`, name: displayId, phone: "+94 77 000 0000" },
          },
        },
      })
    ).id;
  ids.vehicle = await vehicle("VEH039", "Kandy");
  const otherVehicle = await vehicle("VEH001", "Peliyagoda");
  const product = await prisma.product.create({
    data: {
      sku: "FR-MILK",
      name: "Milk",
      brand: "Fresh",
      tempRequirement: "chilled",
      unitLabel: "crate",
      unitWeightKg: 12,
      unitVolumeM3: "0.02",
    },
  });
  const pin = await hashSecret(PIN);
  const password = await hashSecret(PASSWORD);
  const users = await prisma.user.createManyAndReturn({
    data: [
      { loginId: "DRV039", role: "DRIVER", displayName: "Sampath", passwordHash: pin, vehicleId: ids.vehicle },
      { loginId: "DRV001", role: "DRIVER", displayName: "Ruwan S.", passwordHash: pin, vehicleId: otherVehicle },
      { loginId: "OUT108", role: "STORE", displayName: "Ishara", passwordHash: password, outletId: ids.outlet },
      { loginId: "OUT105", role: "STORE", displayName: "Other", passwordHash: password, outletId: ids.otherOutlet },
      {
        loginId: "nimal@waypoint.test",
        role: "DISPATCHER",
        displayName: "Nimal",
        passwordHash: password,
        depot: "Kandy",
      },
      {
        loginId: "colombo@waypoint.test",
        role: "DISPATCHER",
        displayName: "Colombo",
        passwordHash: password,
        depot: "Peliyagoda",
      },
    ],
    select: { id: true, loginId: true },
  });
  ids.dispatcher = users.find((u) => u.loginId === "nimal@waypoint.test")!.id;
  const day = await prisma.planningDay.create({
    data: { depot: "Kandy", date: new Date("2026-10-04"), currentVersion: 1 },
  });
  const trip = await prisma.trip.create({
    data: {
      displayId: "T001",
      tripNo: 1,
      brand: "Fresh",
      status: "DEPARTED",
      plannedDepart: 210,
      plannedMinutes: 120,
      km: 30,
      litres: 5,
      planningDayId: day.id,
      vehicleId: ids.vehicle,
      districtId: district.id,
    },
  });
  const order = await prisma.order.create({
    data: {
      displayId: "ORD10412",
      brand: "Fresh",
      tempRequirement: "chilled",
      requestedDate: new Date("2026-10-04"),
      currentDate: new Date("2026-10-04"),
      status: "OUT_FOR_DELIVERY",
      weightG: 1000,
      volumeL: 10,
      idempotencyKey: randomUUID(),
      outletId: ids.outlet,
      orderLine_orderId: { create: [{ productId: product.id, qtyOrdered: 1, unitWeightKg: 12, unitVolumeM3: "0.02" }] },
    },
  });
  ids.order = order.id;
  await prisma.tripStop.create({
    data: {
      tripId: trip.id,
      tripStatus: "DEPARTED",
      seq: 1,
      etaMin: 360,
      windowOpen: 300,
      windowClose: 480,
      serviceMin: 15,
      orderId: order.id,
    },
  });
}

describe.skipIf(!testDatabaseUrl)("blob upload and authorised reads against PostgreSQL", () => {
  let suite: SuiteDatabase;
  let prisma: PrismaClient;
  let app: App;
  const sessions = {} as Record<Who, { cookie: string; csrf: string; userId: string; deviceId: string; seq: number }>;

  const upload = (who: Who, id: string, bytes: Buffer, mime = "image/jpeg", headers: Record<string, string> = {}) =>
    app.inject({
      method: "PUT",
      url: `/api/sync/blobs/${id}`,
      payload: bytes,
      cookies: { [SESSION_COOKIE]: sessions[who].cookie },
      headers: { "content-type": mime, [CSRF_HEADER]: sessions[who].csrf, ...headers },
    });
  const read = (who: Who, id: string) =>
    app.inject({ method: "GET", url: `/api/blobs/${id}`, cookies: { [SESSION_COOKIE]: sessions[who].cookie } });
  const pod = (blobIds: string[]) => {
    const s = sessions.sampath;
    return app.inject({
      method: "POST",
      url: "/api/sync/events",
      cookies: { [SESSION_COOKIE]: s.cookie },
      headers: { [CSRF_HEADER]: s.csrf },
      payload: {
        deviceId: s.deviceId,
        events: [
          {
            clientEventId: randomUUID(),
            deviceId: s.deviceId,
            deviceSeq: s.seq++,
            schemaVersion: 1,
            subject: { orderId: ids.order },
            source: "FIELD",
            actor: { userId: s.userId, role: "DRIVER" },
            capturedAt: clock.toISOString(),
            type: "POD_CAPTURED",
            payload: { receiverName: "Ishara", photoBlobRefs: blobIds },
          },
        ],
      },
    });
  };

  beforeAll(async () => {
    suite = await createSuiteDatabase("issue50");
    prisma = suite.prisma;
    await seed(prisma);
    app = await buildServer({}, { database: suite.appDatabase, now: () => clock });
    await app.ready();
    const logins: Record<Who, Record<string, string>> = {
      sampath: { role: "DRIVER", loginId: "DRV039", pin: PIN },
      ruwan: { role: "DRIVER", loginId: "DRV001", pin: PIN },
      store: { role: "STORE", loginId: "OUT108", password: PASSWORD },
      otherStore: { role: "STORE", loginId: "OUT105", password: PASSWORD },
      nimal: { role: "DISPATCHER", email: "nimal@waypoint.test", password: PASSWORD, depot: "Kandy" },
      colombo: { role: "DISPATCHER", email: "colombo@waypoint.test", password: PASSWORD, depot: "Peliyagoda" },
    };
    for (const [who, body] of Object.entries(logins) as [Who, Record<string, string>][]) {
      const deviceId = randomUUID();
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: body.pin ? { ...body, deviceId } : body,
        headers: { [CSRF_HEADER]: "1" },
      });
      expect(res.statusCode, res.body).toBe(200);
      sessions[who] = {
        cookie: res.cookies.find((c) => c.name === SESSION_COOKIE)!.value,
        csrf: res.json().csrfToken,
        userId: res.json().user.id,
        deviceId,
        seq: 0,
      };
    }
  });
  afterAll(async () => {
    await app?.close();
    await suite?.drop();
  });

  it("is idempotent: a repeated upload is a no-op and the first upload wins", async () => {
    const id = randomUUID();
    const first = await upload("sampath", id, JPEG);
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json()).toEqual({ clientBlobId: id, mime: "image/jpeg", size: JPEG.byteLength });
    const again = await upload("sampath", id, JPEG);
    expect(again.json()).toEqual(first.json());
    const different = await upload("sampath", id, Buffer.concat([JPEG, JPEG]));
    expect(different.json()).toEqual(first.json());
    expect(await prisma.blob.count({ where: { clientBlobId: id } })).toBe(1);
  });

  it("refuses wrong mime types, mismatched content, oversized or empty bodies and non-field callers", async () => {
    // Refused either way: text/plain parses and fails header validation (400); other types have no parser (415).
    expect((await upload("sampath", randomUUID(), JPEG, "text/plain")).statusCode).toBe(400);
    expect((await upload("sampath", randomUUID(), JPEG, "image/gif")).statusCode).toBe(415);
    const mismatch = await upload("sampath", randomUUID(), JPEG, "image/png");
    expect(mismatch.statusCode).toBe(400);
    expect(mismatch.json()).toMatchObject({ code: "SCHEMA_INVALID", message_key: "blobs.contentMismatch" });
    const big = await upload("sampath", randomUUID(), Buffer.concat([JPEG, Buffer.alloc(524288)]));
    expect(big.statusCode).toBe(413);
    expect(big.json().code).toBe("PAYLOAD_TOO_LARGE");
    expect((await upload("sampath", randomUUID(), Buffer.alloc(0))).statusCode).toBe(400);
    expect((await upload("store", randomUUID(), JPEG)).statusCode).toBe(403);
    expect((await upload("sampath", randomUUID(), JPEG, "image/jpeg", { [CSRF_HEADER]: "nope" })).statusCode).toBe(403);
    expect((await upload("sampath", randomUUID(), PNG, "image/png")).statusCode).toBe(200);
  });

  it("accepts an event while its blob is pending and links the blob when it arrives", async () => {
    const id = randomUUID();
    const event = await pod([id]);
    expect(event.json().results[0].status).toBe("ACCEPTED");
    const eventId = event.json().results[0].serverEventId;
    expect(await prisma.blob.count({ where: { clientBlobId: id } })).toBe(0);
    expect((await upload("sampath", id, JPEG)).statusCode).toBe(200);
    expect((await prisma.blob.findUniqueOrThrow({ where: { clientBlobId: id } })).ownerEventId).toBe(eventId);
  });

  it("links a blob that arrived before its event", async () => {
    const id = randomUUID();
    await upload("sampath", id, JPEG);
    expect((await prisma.blob.findUniqueOrThrow({ where: { clientBlobId: id } })).ownerEventId).toBeNull();
    const eventId = (await pod([id])).json().results[0].serverEventId;
    expect((await prisma.blob.findUniqueOrThrow({ where: { clientBlobId: id } })).ownerEventId).toBe(eventId);
  });

  it("serves the bytes only to the depot's dispatcher, the outlet's store and the uploader", async () => {
    const id = randomUUID();
    await upload("sampath", id, JPEG);
    await pod([id]);
    for (const who of ["sampath", "store", "nimal"] as const) {
      const res = await read(who, id);
      expect(res.statusCode, who).toBe(200);
      expect(res.headers["content-type"]).toBe("image/jpeg");
      expect(res.headers["cache-control"]).toBe("private, max-age=86400");
      expect(res.rawPayload.equals(JPEG)).toBe(true);
    }
    for (const who of ["ruwan", "otherStore", "colombo"] as const) {
      expect((await read(who, id)).statusCode, who).toBe(403);
    }
    expect((await read("nimal", randomUUID())).statusCode).toBe(404);
  });

  it("serves an unlinked blob to nobody", async () => {
    const id = randomUUID();
    await upload("sampath", id, JPEG);
    expect((await read("nimal", id)).statusCode).toBe(403);
    expect((await read("sampath", id)).statusCode).toBe(403);
  });
});
