import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { setupFiles: ["src/sync/test-setup.ts"], include: ["src/**/*.test.ts"] },
});
