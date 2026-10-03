import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Pool } from "pg";
import type { PrismaClient } from "../../src/generated/prisma/client";
import { createDatabase, type Database } from "../../src/lib/database";

export const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (testDatabaseUrl && !new URL(testDatabaseUrl).pathname.endsWith("_test")) {
  throw new Error(
    "Set TEST_DATABASE_URL to a disposable PostgreSQL database whose name ends in _test; see prisma-rules.md.",
  );
}

export interface SuiteDatabase {
  database: Database;
  prisma: PrismaClient;
  /** Hand this to buildServer: the suite, not the app, owns the client lifecycle. */
  appDatabase: Database;
  drop(): Promise<void>;
}

/** A uniquely named schema with every migration deployed, dropped again by `drop()`. */
export async function createSuiteDatabase(prefix: string): Promise<SuiteDatabase> {
  if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is not set");
  const schema = `${prefix}_${randomUUID().replaceAll("-", "")}`;
  const url = new URL(testDatabaseUrl);
  url.searchParams.set("schema", schema);
  const admin = new Pool({ connectionString: testDatabaseUrl, connectionTimeoutMillis: 2000 });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const cli = fileURLToPath(new URL("../../node_modules/prisma/build/index.js", import.meta.url));
  await promisify(execFile)(process.execPath, [cli, "migrate", "deploy"], {
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
    env: { ...process.env, DATABASE_URL: url.toString() },
    timeout: 30000,
  });
  const database = createDatabase(url.toString());
  return {
    database,
    prisma: database.prisma!,
    appDatabase: { ...database, close: async () => {} },
    async drop() {
      await database.close();
      try {
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      } finally {
        await admin.end();
      }
    },
  };
}
