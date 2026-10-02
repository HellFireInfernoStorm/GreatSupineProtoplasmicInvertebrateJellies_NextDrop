import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { createReadiness, repositoryMigrations, type Migration, type Readiness } from "./readiness";

export function createDatabase(url = process.env.DATABASE_URL): { ready: Readiness; close: () => Promise<void> } {
  if (!url) {
    return {
      ready: async () => ({ status: "unavailable", checks: { database: "failed", migrations: "failed" } }),
      close: async () => {},
    };
  }
  const adapter = new PrismaPg({ connectionString: url, connectionTimeoutMillis: 2000, query_timeout: 2000 });
  const prisma = new PrismaClient({ adapter });
  return {
    ready: createReadiness(
      {
        connect: async () => {
          await prisma.$queryRaw`SELECT 1`;
        },
        migrations: () => prisma.$queryRaw<Migration[]>`
          SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations"
        `,
      },
      repositoryMigrations(),
    ),
    close: () => prisma.$disconnect(),
  };
}
