import { randomUUID } from "node:crypto";
import { request as httpRequest, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "../src/generated/prisma/client";
import { CSRF_HEADER, hashSecret, SESSION_COOKIE } from "../src/modules/auth";
import { appendFeed, type FeedRowInput } from "../src/modules/feed";
import { createNotifier } from "../src/modules/notifications";
import { buildServer, type App } from "../src/server";
import { createSuiteDatabase, testDatabaseUrl, type SuiteDatabase } from "./support/suite-database";

if (!testDatabaseUrl)
  console.info("Skipping feed integration tests: set TEST_DATABASE_URL to a disposable _test database.");

const PASSWORD = "demo-password";
const PIN = "4321";
const ids = {} as Record<"out015" | "out101" | "veh001" | "veh040", string>;
type Login = Record<string, string>;
const logins = {
  store: { role: "STORE", loginId: "OUT015", password: PASSWORD },
  dispatcherAll: { role: "DISPATCHER", email: "nimal@waypoint.test", password: PASSWORD, depot: "Kandy" },
  dispatcherPeliyagoda: { role: "DISPATCHER", email: "kasun@waypoint.test", password: PASSWORD, depot: "Peliyagoda" },
  dispatcherKandy: { role: "DISPATCHER", email: "kandy@waypoint.test", password: PASSWORD, depot: "Kandy" },
  loaderKandy: { role: "LOADER", loginId: "LDR002", pin: PIN, deviceId: randomUUID() },
  driverKandy: { role: "DRIVER", loginId: "DRV040", pin: PIN, deviceId: randomUUID() },
  driverPeliyagoda: { role: "DRIVER", loginId: "DRV001", pin: PIN, deviceId: randomUUID() },
} satisfies Record<string, Login>;

async function seed(prisma: PrismaClient) {
  const district = (name: string, depot: string) =>
    prisma.district.create({
      data: {
        name,
        depot,
        roadClass: "urban",
        freeFlowKmh: 40,
        depotToDistrictKm: 10,
        depotToDistrictFreeflowMin: 15,
        interStopKm: 1,
        interStopFreeflowMin: 3,
      },
    });
  const colombo = await district("Colombo", "Peliyagoda");
  const kandy = await district("Kandy", "Kandy");
  const outlet = async (displayId: string, districtId: string, depot: string) =>
    (
      await prisma.outlet.create({
        data: {
          displayId,
          brand: "Fresh",
          depot,
          dockType: "rear_dock",
          parkingConstraint: "normal",
          windowOpen: 300,
          windowClose: 600,
          districtId,
        },
      })
    ).id;
  ids.out015 = await outlet("OUT015", colombo.id, "Peliyagoda");
  ids.out101 = await outlet("OUT101", kandy.id, "Kandy");
  const vehicle = async (displayId: string, depot: string) =>
    (
      await prisma.vehicle.create({
        data: {
          displayId,
          type: "van",
          temp: "reefer",
          weightCapKg: 1000,
          volumeCapM3: 10,
          fuelType: "diesel",
          kmPerL: 8,
          weeklyFuelQuotaL: 200,
          depot,
        },
      })
    ).id;
  ids.veh001 = await vehicle("VEH001", "Peliyagoda");
  ids.veh040 = await vehicle("VEH040", "Kandy");
  const password = await hashSecret(PASSWORD);
  const pin = await hashSecret(PIN);
  await prisma.user.createMany({
    data: [
      {
        loginId: "dilini@waypoint.test",
        role: "STORE",
        displayName: "Dilini",
        passwordHash: password,
        outletId: ids.out015,
      },
      { loginId: "nimal@waypoint.test", role: "DISPATCHER", displayName: "Nimal", passwordHash: password },
      {
        loginId: "kasun@waypoint.test",
        role: "DISPATCHER",
        displayName: "Peliyagoda",
        passwordHash: password,
        depot: "Peliyagoda",
      },
      {
        loginId: "kandy@waypoint.test",
        role: "DISPATCHER",
        displayName: "Kandy",
        passwordHash: password,
        depot: "Kandy",
      },
      { loginId: "LDR002", role: "LOADER", displayName: "Kandy loader", passwordHash: pin, depot: "Kandy" },
      { loginId: "DRV040", role: "DRIVER", displayName: "Sampath", passwordHash: pin, vehicleId: ids.veh040 },
      { loginId: "DRV001", role: "DRIVER", displayName: "Ruwan S.", passwordHash: pin, vehicleId: ids.veh001 },
    ],
  });
}

const entity = () => ({ type: "order", id: randomUUID() });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!testDatabaseUrl)("change feed and notifications against PostgreSQL", () => {
  let suite: SuiteDatabase;
  let prisma: PrismaClient;
  let app: App;
  const sessions = {} as Record<keyof typeof logins, { cookie: string; csrf: string; userId: string }>;

  const write = (rows: FeedRowInput[]) =>
    prisma.$transaction((tx) => appendFeed(tx, rows), { maxWait: 10_000, timeout: 10_000 });
  const get = (who: keyof typeof logins, url: string) =>
    app.inject({ method: "GET", url, cookies: { [SESSION_COOKIE]: sessions[who].cookie } });
  const post = (who: keyof typeof logins, url: string, payload: object, csrf = sessions[who].csrf) =>
    app.inject({
      method: "POST",
      url,
      payload,
      cookies: { [SESSION_COOKIE]: sessions[who].cookie },
      headers: { [CSRF_HEADER]: csrf },
    });
  const head = async () =>
    (await prisma.feedCounter.findUniqueOrThrow({ where: { singleton: true }, select: { head: true } })).head;

  beforeAll(async () => {
    suite = await createSuiteDatabase("issue41");
    prisma = suite.prisma;
    await seed(prisma);
    app = await buildServer({}, { database: suite.appDatabase, feed: { heartbeatMs: 150, pollMs: 50 } });
    await app.ready();
    for (const [who, body] of Object.entries(logins) as [keyof typeof logins, Login][]) {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: body,
        headers: { [CSRF_HEADER]: "1" },
      });
      expect(res.statusCode, res.body).toBe(200);
      const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE)!.value;
      sessions[who] = { cookie, csrf: res.json().csrfToken, userId: res.json().user.id };
    }
  });
  afterAll(async () => {
    await app?.close();
    await suite?.drop();
  });

  describe("appendFeed", () => {
    it("allocates gap-free, commit-ordered sequences under concurrent writers, including rollbacks", async () => {
      const start = await head();
      const writers = Array.from({ length: 16 }, (_, i) =>
        prisma
          .$transaction(
            async (tx) => {
              await tx.$executeRaw`SELECT pg_sleep(${Math.random() * 0.03})`;
              const seqs = await appendFeed(tx, [
                { kind: "order_changed", entity: entity(), audience: { roles: ["DISPATCHER"], depot: "Peliyagoda" } },
                { kind: "order_changed", entity: entity(), audience: { roles: ["DISPATCHER"], depot: "Peliyagoda" } },
              ]);
              // Hold the counter lock a little before committing so writers really queue behind each other.
              await tx.$executeRaw`SELECT pg_sleep(0.01)`;
              if (i % 5 === 0) throw new Error("rolled back on purpose");
              return seqs;
            },
            { maxWait: 20_000, timeout: 20_000 },
          )
          .catch((error: Error) => {
            if (error.message !== "rolled back on purpose") throw error;
            return null;
          }),
      );

      // A concurrent reader that always reads head first never sees a hole below it.
      let cursor = start;
      let done = false;
      const reader = (async () => {
        while (!done) {
          const h = await head();
          const rows = await prisma.changeFeed.findMany({
            where: { seq: { gt: cursor, lte: h } },
            select: { seq: true },
            orderBy: { seq: "asc" },
          });
          expect(rows.map((r) => r.seq)).toEqual(
            Array.from({ length: Number(h - cursor) }, (_, i) => cursor + BigInt(i) + 1n),
          );
          cursor = h;
          await sleep(5);
        }
      })();
      const results = await Promise.all(writers);
      done = true;
      await reader;

      const committed = results.filter((r) => r !== null);
      expect(committed).toHaveLength(12);
      const end = await head();
      expect(end - start).toBe(24n);
      const seqs = (
        await prisma.changeFeed.findMany({
          where: { seq: { gt: start } },
          select: { seq: true },
          orderBy: { seq: "asc" },
        })
      ).map((r) => r.seq);
      expect(seqs).toEqual(Array.from({ length: 24 }, (_, i) => start + BigInt(i) + 1n));
      // Each transaction got a consecutive pair.
      for (const pair of committed) expect(pair![1]! - pair![0]!).toBe(1n);
    });

    it("refuses a row without audience roles", async () => {
      await expect(write([{ kind: "order_changed", entity: entity(), audience: { roles: [] } }])).rejects.toThrow(
        /no audience roles/,
      );
    });
  });

  describe("GET /changes", () => {
    const visible = {} as Record<"a" | "b" | "c" | "d" | "e", string>;
    let after: bigint;

    beforeAll(async () => {
      after = await head();
      const row = (key: keyof typeof visible, input: Omit<FeedRowInput, "entity">): FeedRowInput => {
        visible[key] = randomUUID();
        return { ...input, entity: { type: "order", id: visible[key] } };
      };
      await write([
        row("a", {
          kind: "order_changed",
          version: 2,
          audience: { roles: ["STORE", "DISPATCHER", "LOADER"], depot: "Peliyagoda", outletId: ids.out015 },
        }),
        row("b", {
          kind: "order_changed",
          audience: {
            roles: ["STORE", "DISPATCHER", "LOADER", "DRIVER"],
            depot: "Kandy",
            outletId: ids.out101,
            vehicleId: ids.veh040,
          },
        }),
        row("c", {
          kind: "availability_changed",
          audience: { roles: ["DISPATCHER"], depot: "Peliyagoda", vehicleId: ids.veh001 },
        }),
        row("d", { kind: "plan_published", audience: { roles: ["STORE", "DISPATCHER", "LOADER", "DRIVER"] } }),
        row("e", { kind: "run_updated", audience: { roles: ["DISPATCHER"] } }),
      ]);
    });

    const seen = async (who: keyof typeof logins) => {
      const res = await get(who, `/api/changes?after=${after}`);
      expect(res.statusCode, res.body).toBe(200);
      const byId = Object.fromEntries(Object.entries(visible).map(([key, id]) => [id, key]));
      return (res.json().items as { entity: { id: string } }[]).map((item) => byId[item.entity.id]).sort();
    };

    it("returns only each role's audience", async () => {
      expect(await seen("store")).toEqual(["a", "d"]);
      expect(await seen("dispatcherPeliyagoda")).toEqual(["a", "c", "d", "e"]);
      expect(await seen("dispatcherKandy")).toEqual(["b", "d", "e"]);
      expect(await seen("dispatcherAll")).toEqual(["a", "b", "c", "d", "e"]);
      expect(await seen("loaderKandy")).toEqual(["b", "d"]);
      expect(await seen("driverKandy")).toEqual(["b", "d"]);
      expect(await seen("driverPeliyagoda")).toEqual(["d"]);
    });

    it("serialises seq and head as strings and includes resetEpoch", async () => {
      const res = await get("store", `/api/changes?after=${after}`);
      const body = res.json();
      const h = await head();
      expect(body.head).toBe(h.toString());
      expect(body.resetEpoch).toBe(0);
      expect(body.items[0]).toEqual({
        seq: (after + 1n).toString(),
        kind: "order_changed",
        entity: { type: "order", id: visible.a },
        version: 2,
        at: expect.stringMatching(/Z$/),
      });
      expect(body.items[1]).not.toHaveProperty("version");
    });

    it("pages by limit and returns nothing past head", async () => {
      const page = await get("dispatcherAll", `/api/changes?after=${after}&limit=2`);
      expect(page.json().items.map((i: { entity: { id: string } }) => i.entity.id)).toEqual([visible.a, visible.b]);
      const past = await get("dispatcherAll", `/api/changes?after=${(await head()) + 10n}`);
      expect(past.json().items).toEqual([]);
    });

    it("validates the cursor and requires a session", async () => {
      expect((await get("store", "/api/changes?after=abc")).statusCode).toBe(400);
      expect((await get("store", "/api/changes")).statusCode).toBe(400);
      expect((await app.inject({ method: "GET", url: "/api/changes?after=0" })).statusCode).toBe(401);
    });
  });

  describe("notifications", () => {
    const notifier = createNotifier(() => new Date());
    const notify = (input: Parameters<typeof notifier.notify>[1]) =>
      prisma.$transaction(async (tx) => {
        const feed = await notifier.notify(tx, input);
        await appendFeed(tx, feed);
        return feed;
      });
    const list = async (who: keyof typeof logins, query = "") => (await get(who, `/api/notifications${query}`)).json();

    it("fans out to every user in scope with their own read state and a feed hint", async () => {
      const before = await head();
      const trip = randomUUID();
      const feed = await notify({
        kind: "short_reported",
        audience: { role: "DISPATCHER", depot: "Peliyagoda" },
        params: { order: "ORD10412" },
        entity: { type: "trip", id: trip },
      });
      expect(feed).toHaveLength(1);
      expect(await head()).toBe(before + 1n);

      const kasun = await list("dispatcherPeliyagoda");
      expect(kasun.unreadCount).toBe(1);
      expect(kasun.items).toEqual([
        {
          id: expect.any(String),
          kind: "short_reported",
          titleKey: "notifications.short_reported",
          params: { order: "ORD10412" },
          entityRef: { type: "trip", id: trip },
          createdAt: expect.stringMatching(/Z$/),
          readAt: null,
          group: "NEEDS_ACTION",
        },
      ]);
      // Nimal covers every depot; the Kandy dispatcher is out of scope.
      expect((await list("dispatcherAll")).unreadCount).toBe(1);
      expect((await list("dispatcherKandy")).items).toEqual([]);

      const read = await post("dispatcherPeliyagoda", "/api/notifications/read", { all: true });
      expect(read.statusCode).toBe(200);
      expect(read.json()).toEqual({ updatedCount: 1, readAt: expect.stringMatching(/Z$/) });
      expect((await list("dispatcherPeliyagoda")).unreadCount).toBe(0);
      expect((await list("dispatcherPeliyagoda")).items[0].readAt).toEqual(expect.any(String));
      expect((await list("dispatcherAll")).unreadCount).toBe(1);

      const hint = await get("dispatcherKandy", `/api/changes?after=${before}`);
      expect(hint.json().items).toEqual([]);
      const own = await get("dispatcherPeliyagoda", `/api/changes?after=${before}`);
      expect(own.json().items).toEqual([expect.objectContaining({ kind: "notification_created" })]);
    });

    it("marks only the caller's own ids as read", async () => {
      await notify({ kind: "plan_changed", audience: { role: "DRIVER", vehicleId: ids.veh040 }, entity: entity() });
      const mine = (await list("driverKandy")).items[0].id as string;
      const foreign = await post("driverPeliyagoda", "/api/notifications/read", { all: false, ids: [mine] });
      expect(foreign.json().updatedCount).toBe(0);
      const ok = await post("driverKandy", "/api/notifications/read", { all: false, ids: [mine] });
      expect(ok.json().updatedCount).toBe(1);
      expect(
        (await post("driverKandy", "/api/notifications/read", { all: false, ids: [mine] })).json().updatedCount,
      ).toBe(0);
    });

    it("pages newest first, filters unread and serves the store alias", async () => {
      for (const kind of ["deferral_notice", "eta_updated", "delivered"] as const) {
        await notify({ kind, audience: { role: "STORE", outletId: ids.out015 }, entity: entity() });
      }
      const first = await (await get("store", "/api/store/notifications?limit=2")).json();
      expect(first.items.map((i: { kind: string }) => i.kind)).toEqual(["delivered", "eta_updated"]);
      expect(first.items.map((i: { group: string }) => i.group)).toEqual(["DELIVERIES", "DELIVERIES"]);
      expect(first.unreadCount).toBe(3);
      const second = await (await get("store", `/api/store/notifications?limit=2&after=${first.nextCursor}`)).json();
      expect(second.items.map((i: { kind: string }) => i.kind)).toEqual(["deferral_notice"]);
      expect(second.nextCursor).toBeNull();

      await post("store", "/api/store/notifications/read", { all: false, ids: [first.items[0].id] });
      const unread = await (await get("store", "/api/store/notifications?unreadOnly=true")).json();
      expect(unread.items).toHaveLength(2);
      expect(unread.unreadCount).toBe(2);
    });

    it("refuses the store alias to other roles, bad cursors and reads without the CSRF token", async () => {
      expect((await get("dispatcherAll", "/api/store/notifications")).statusCode).toBe(403);
      expect((await get("store", "/api/notifications?after=nope")).statusCode).toBe(400);
      expect((await post("store", "/api/notifications/read", { all: true }, "wrong")).statusCode).toBe(403);
    });

    it("creates nothing when no user is in scope", async () => {
      const before = await head();
      const feed = await notify({
        kind: "plan_changed",
        audience: { role: "LOADER", depot: "Nowhere" },
        entity: entity(),
      });
      expect(feed).toEqual([]);
      expect(await head()).toBe(before);
    });
  });

  describe("GET /stream", () => {
    let base: string;
    beforeAll(async () => {
      await app.listen({ port: 0, host: "127.0.0.1" });
      base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    });

    function open(who: keyof typeof logins) {
      return new Promise<IncomingMessage>((resolve, reject) => {
        const req = httpRequest(`${base}/api/stream?after=0`, {
          headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(sessions[who].cookie)}` },
        });
        req.on("response", resolve).on("error", reject).end();
      });
    }
    function reader(res: IncomingMessage) {
      let buffer = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => (buffer += chunk));
      return {
        text: () => buffer,
        async until(predicate: (text: string) => boolean, timeoutMs = 3000) {
          const deadline = Date.now() + timeoutMs;
          while (!predicate(buffer)) {
            if (Date.now() > deadline) throw new Error(`stream timed out; received: ${buffer}`);
            await sleep(20);
          }
        },
      };
    }

    it("sends the head on connect, a hint after a write, and heartbeats, unbuffered", async () => {
      const res = await open("store");
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toBe("text/event-stream; charset=utf-8");
      expect(res.headers["x-accel-buffering"]).toBe("no");
      expect(res.headers["cache-control"]).toBe("no-cache, no-transform");
      const stream = reader(res);
      const current = (await head()).toString();
      await stream.until((t) => t.includes(`data: {"head":"${current}","resetEpoch":0}`));

      const seqs = await write([{ kind: "run_updated", entity: entity(), audience: { roles: ["DISPATCHER"] } }]);
      await stream.until((t) => t.includes(`data: {"head":"${seqs[0]}","resetEpoch":0}`));
      await stream.until((t) => t.includes(": heartbeat"));
      res.destroy();
    });

    it("closes when the session ends", async () => {
      const login = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { ...logins.loaderKandy, deviceId: randomUUID() },
        headers: { [CSRF_HEADER]: "1" },
      });
      const cookie = login.cookies.find((c) => c.name === SESSION_COOKIE)!.value;
      const res = await new Promise<IncomingMessage>((resolve, reject) => {
        httpRequest(`${base}/api/stream?after=0`, {
          headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(cookie)}` },
        })
          .on("response", resolve)
          .on("error", reject)
          .end();
      });
      const ended = new Promise<void>((resolve) => res.on("end", resolve));
      res.resume();
      await app.inject({
        method: "POST",
        url: "/api/auth/logout",
        cookies: { [SESSION_COOKIE]: cookie },
        headers: { [CSRF_HEADER]: login.json().csrfToken },
      });
      await ended;
    });

    it("requires a session", async () => {
      const res = await new Promise<IncomingMessage>((resolve, reject) => {
        httpRequest(`${base}/api/stream?after=0`).on("response", resolve).on("error", reject).end();
      });
      expect(res.statusCode).toBe(401);
      res.resume();
    });
  });
});
