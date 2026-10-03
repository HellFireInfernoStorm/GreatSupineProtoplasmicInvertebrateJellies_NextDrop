import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { createReadiness, repositoryMigrations, type Migration, type Readiness } from "./readiness";

export type Database = {
  prisma: PrismaClient | null;
  /** The PostgreSQL schema the models live in. Raw SQL does not inherit it from the adapter. */
  schema?: string;
  ready: Readiness;
  close: () => Promise<void>;
};

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient | null;
  }
}

export function createDatabase(url = process.env.DATABASE_URL, options: { migrationsDirectory?: URL } = {}): Database {
  if (!url) {
    return {
      prisma: null,
      ready: async () => ({ status: "unavailable", checks: { database: "failed", migrations: "failed" } }),
      close: async () => {},
    };
  }
  const schema = new URL(url).searchParams.get("schema") ?? "public";
  const adapter = new PrismaPg({ connectionString: url }, { schema });
  const prisma = new PrismaClient({ adapter });
  // Isolate probe limits from publication/locking transactions on the shared application client.
  const probe = new PrismaClient({
    adapter: new PrismaPg(
      {
        connectionString: url,
        max: 1,
        connectionTimeoutMillis: 2000,
        query_timeout: 2000,
        statement_timeout: 2000,
      },
      { schema },
    ),
  });
  return {
    prisma,
    schema,
    ready: createReadiness(
      {
        connect: async () => {
          await probe.$queryRaw`SELECT 1`;
        },
        migrations: () =>
          probe.$transaction(async (tx) => {
            // Parameterized identifier text: raw queries do not inherit the adapter's model schema.
            const searchPath = `"${schema.replaceAll('"', '""')}"`;
            await tx.$queryRaw`SELECT set_config('search_path', ${searchPath}, true)`;
            return tx.$queryRaw<Migration[]>`
            SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations"
          `;
          }),
      },
      repositoryMigrations(options.migrationsDirectory),
    ),
    close: async () => {
      await Promise.all([prisma.$disconnect(), probe.$disconnect()]);
    },
  };
}
