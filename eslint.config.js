import { base, formatting, node, react } from "@nextdrop/config/eslint";

export default [
  { ignores: ["**/dist/**", "**/coverage/**", "scripts/agent-context/**"] },
  ...base,
  ...node.map((c) => ({ ...c, files: ["apps/api/**", "packages/**", "*.{js,ts}", "**/*.config.{js,ts}"] })),
  ...react.map((c) => ({ ...c, files: ["apps/web/src/**/*.{ts,tsx}"] })),
  ...formatting,
];
