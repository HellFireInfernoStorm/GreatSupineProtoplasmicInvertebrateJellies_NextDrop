import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations", seed: "tsx prisma/seed/index.ts" },
  datasource: {
    url: process.env.DATABASE_URL ?? "postgresql://localhost:5432/nextdrop",
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
