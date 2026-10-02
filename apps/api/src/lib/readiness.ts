import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type Migration = {
  migration_name: string;
  checksum: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
};
export type Readiness = () => Promise<{
  status: "ok" | "unavailable";
  checks: Record<string, "ok" | "failed">;
}>;

export function repositoryMigrations(): Map<string, string> {
  const directory = fileURLToPath(new URL("../../prisma/migrations/", import.meta.url));
  return new Map(
    readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => [
        entry.name,
        createHash("sha256")
          .update(readFileSync(`${directory}/${entry.name}/migration.sql`))
          .digest("hex"),
      ]),
  );
}

export function createReadiness(
  probe: { connect: () => Promise<void>; migrations: () => Promise<Migration[]> },
  expected: ReadonlyMap<string, string>,
): Readiness {
  return async () => {
    const checks: Record<string, "ok" | "failed"> = { database: "failed", migrations: "failed" };
    try {
      await probe.connect();
      checks.database = "ok";
      const rows = (await probe.migrations()).filter((row) => !row.rolled_back_at);
      const applied = new Map(rows.filter((row) => row.finished_at).map((row) => [row.migration_name, row.checksum]));
      if (
        expected.size > 0 &&
        rows.every((row) => row.finished_at) &&
        [...expected].every(([name, checksum]) => applied.get(name) === checksum)
      ) {
        checks.migrations = "ok";
      }
    } catch {
      // Public readiness reports availability, never connection strings or database errors.
    }
    return { status: Object.values(checks).every((check) => check === "ok") ? "ok" : "unavailable", checks };
  };
}
