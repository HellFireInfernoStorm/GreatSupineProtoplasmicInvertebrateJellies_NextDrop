import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["src/**/*.test.ts", "prisma/seed/**/*.test.ts"] },
});
