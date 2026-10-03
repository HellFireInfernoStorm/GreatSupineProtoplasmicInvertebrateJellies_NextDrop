import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer, type App } from "../server";
import { cacheControlFor } from "./web-app";

describe("cacheControlFor", () => {
  it("never caches the app shell or the service worker", () => {
    expect(cacheControlFor("index.html")).toBe("no-store");
    expect(cacheControlFor("sw.js")).toBe("no-store");
  });

  it("marks fingerprinted assets immutable and revalidates everything else", () => {
    expect(cacheControlFor("assets/index-B1x2y3.js")).toBe("public, max-age=31536000, immutable");
    expect(cacheControlFor("manifest.webmanifest")).toBe("no-cache");
    expect(cacheControlFor("nested/sw.js")).toBe("no-cache");
  });
});

describe("built PWA served by the API", () => {
  let app: App;
  let root: string;
  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "nextdrop-web-"));
    mkdirSync(join(root, "assets"));
    writeFileSync(join(root, "index.html"), "<!doctype html><title>NextDrop</title>");
    writeFileSync(join(root, "sw.js"), "self.addEventListener('install', () => {});");
    writeFileSync(join(root, "assets", "index-abc123.js"), "console.log(1);");
    writeFileSync(join(root, "manifest.webmanifest"), "{}");
    app = await buildServer(
      {},
      { ready: async () => ({ status: "ok", checks: { database: "ok", migrations: "ok" } }), webRoot: root },
    );
  });
  afterAll(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  it.each(["/", "/login", "/driver/stops/3?x=1"])("serves index.html for %s with no-store", async (url) => {
    const res = await app.inject({ method: "GET", url });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toContain("<title>NextDrop</title>");
  });

  it("serves sw.js with no-store", async () => {
    const res = await app.inject({ method: "GET", url: "/sw.js" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("serves hashed assets as immutable", async () => {
    const res = await app.inject({ method: "GET", url: "/assets/index-abc123.js" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
  });

  it("revalidates other static files", async () => {
    const res = await app.inject({ method: "GET", url: "/manifest.webmanifest" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-cache");
  });

  it("keeps API routes and the JSON 404 for unknown API paths", async () => {
    expect((await app.inject({ method: "GET", url: "/api/healthz" })).json()).toEqual({ status: "ok" });
    const missing = await app.inject({ method: "GET", url: "/api/nope" });
    expect(missing.statusCode).toBe(404);
    expect(missing.headers["content-type"]).toMatch(/application\/json/);
  });

  it("does not serve files outside the build directory", async () => {
    const res = await app.inject({ method: "GET", url: "/..%2f..%2fpackage.json" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("<title>NextDrop</title>");
  });

  it("leaves non-GET requests to the JSON 404", async () => {
    const res = await app.inject({ method: "POST", url: "/login", headers: { "x-nextdrop-csrf": "x" } });
    expect(res.statusCode).toBe(404);
  });

  it("refuses a build directory without index.html", async () => {
    const empty = mkdtempSync(join(tmpdir(), "nextdrop-web-empty-"));
    await expect(
      buildServer(
        {},
        { ready: async () => ({ status: "ok", checks: { database: "ok", migrations: "ok" } }), webRoot: empty },
      ),
    ).rejects.toThrow(/index\.html/);
    rmSync(empty, { recursive: true, force: true });
  });
});
