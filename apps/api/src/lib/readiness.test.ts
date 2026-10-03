import { describe, expect, it } from "vitest";
import { createReadiness, type Migration } from "./readiness";
import { buildServer } from "../server";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { repositoryMigrations } from "./readiness";

const expected = new Map([["initial", "checksum"]]);
const applied: Migration = {
  migration_name: "initial",
  checksum: "checksum",
  finished_at: new Date(),
  rolled_back_at: null,
};
const connect = async () => {};

describe("database readiness", () => {
  it.each(["missing", "incomplete"])("reports %s runtime migration files as unavailable", async (kind) => {
    const root = mkdtempSync(join(tmpdir(), "nextdrop25-manifest-"));
    try {
      const directory = kind === "missing" ? join(root, "missing") : root;
      if (kind === "incomplete") mkdirSync(join(root, "initial"));
      const manifest = repositoryMigrations(pathToFileURL(directory));
      expect(manifest).toBeNull();
      const ready = createReadiness({ connect, migrations: async () => [applied] }, manifest);
      expect(await ready()).toEqual({ status: "unavailable", checks: { database: "ok", migrations: "failed" } });
    } finally {
      rmSync(root, { recursive: true });
    }
  });
  it("requires all repository migration checksums and successful completion", async () => {
    const ready = createReadiness({ connect, migrations: async () => [applied] }, expected);
    expect(await ready()).toEqual({ status: "ok", checks: { database: "ok", migrations: "ok" } });
  });

  it.each([
    { rows: [] },
    { rows: [{ ...applied, finished_at: null }] },
    { rows: [{ ...applied, checksum: "modified" }] },
    { rows: [{ ...applied, rolled_back_at: new Date() }] },
    { rows: [applied, { ...applied, migration_name: "failed", finished_at: null }] },
  ])("rejects missing, failed, modified and rolled-back migrations: $rows", async ({ rows }) => {
    const ready = createReadiness({ connect, migrations: async () => rows }, expected);
    expect(await ready()).toEqual({ status: "unavailable", checks: { database: "ok", migrations: "failed" } });
  });

  it("accepts a rolled-back attempt followed by a completed retry", async () => {
    const ready = createReadiness(
      { connect, migrations: async () => [{ ...applied, finished_at: null, rolled_back_at: new Date() }, applied] },
      expected,
    );
    expect((await ready()).status).toBe("ok");
  });

  it("reports missing migration table as unavailable", async () => {
    const ready = createReadiness(
      {
        connect,
        migrations: async () => {
          throw new Error("table missing");
        },
      },
      expected,
    );
    expect((await ready()).checks).toEqual({ database: "ok", migrations: "failed" });
  });

  it("returns 503 without leaking connection errors and keeps health live", async () => {
    const ready = createReadiness(
      {
        connect: async () => {
          throw new Error("secret connection detail");
        },
        migrations: async () => [applied],
      },
      expected,
    );
    const app = await buildServer({}, { ready });
    try {
      const response = await app.inject("/api/readyz");
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ status: "unavailable", checks: { database: "failed", migrations: "failed" } });
      expect((await app.inject("/api/healthz")).statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});
