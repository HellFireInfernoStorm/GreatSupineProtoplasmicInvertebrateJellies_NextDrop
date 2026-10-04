import { base, formatting, node, react, rulesPurity } from "@nextdrop/config/eslint";

export default [
  {
    ignores: [
      "**/dist/**",
      "**/coverage/**",
      "scripts/agent-context/**",
      "apps/api/src/generated/**",
      ".pnpm-store/**",
      "e2e/test-results/**",
      "e2e/playwright-report/**",
    ],
  },
  ...base,
  ...node.map((c) => ({
    ...c,
    files: ["apps/api/**", "packages/**", "e2e/**", "*.{js,ts}", "**/*.config.{js,ts}", "scripts/docs/**"],
  })),
  ...react.map((c) => ({ ...c, files: ["apps/web/src/**/*.{ts,tsx}"] })),
  ...rulesPurity.map((c) => ({
    ...c,
    files: ["packages/rules/src/**/*.ts"],
    ignores: ["**/*.test.ts", "packages/rules/src/test-support/**"],
  })),
  ...formatting,
];
