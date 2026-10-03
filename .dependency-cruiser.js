// Module boundaries from agent-docs/spec/platform/stack-and-layout.md §3.3. Run with `pnpm deps:check`.
// Workspace packages resolve through their node_modules symlinks to packages/*, so rules match repo paths.
// Imports that cannot resolve (a package missing from package.json) keep their bare name, hence the @nextdrop/* and
// @prisma/* alternatives below.

const API = "^(apps/api/|@nextdrop/api$)";
const WEB = "^(apps/web/|@nextdrop/web$)";
const PRISMA = "(^|/)(@prisma/|prisma$)|^apps/api/src/generated/prisma/";
const MODULE = "^apps/api/src/modules/([^/]+)/";
const TESTS = ["\\.test\\.tsx?$", "^packages/rules/src/test-support/"];

/** @type {import('dependency-cruiser').IConfiguration} */
export default {
  forbidden: [
    {
      name: "rules-imports-nothing-from-the-repo",
      comment: "packages/rules imports nothing from the repo (§3.3).",
      severity: "error",
      from: { path: "^packages/rules/" },
      to: { path: "^(apps/|e2e/|packages/(?!rules/)|@nextdrop/(?!rules$))" },
    },
    {
      name: "rules-has-no-runtime-dependencies",
      comment: "packages/rules has zero runtime dependencies (§3.3). Tests may use dev dependencies.",
      severity: "error",
      from: { path: "^packages/rules/src/", pathNot: TESTS },
      to: {
        dependencyTypes: [
          "npm",
          "npm-dev",
          "npm-optional",
          "npm-peer",
          "npm-bundled",
          "npm-no-pkg",
          "npm-unknown",
          "unknown",
        ],
      },
    },
    {
      name: "contracts-imports-only-rules",
      comment: "packages/contracts may import from packages/rules and nothing else in the repo (§3.3).",
      severity: "error",
      from: { path: "^packages/contracts/" },
      to: { path: "^(apps/|e2e/|packages/(?!(contracts|rules)/)|@nextdrop/(?!(contracts|rules)$))" },
    },
    {
      name: "contracts-imports-only-types-from-rules",
      comment:
        "§3.3 says contracts 'may import types from rules'. Merged code also imports values; " +
        "a warning until the reading is settled on #26.",
      severity: "warn",
      from: { path: "^packages/contracts/src/", pathNot: TESTS },
      to: { path: "^packages/rules/", dependencyTypesNot: ["type-only"] },
    },
    {
      name: "web-must-not-import-api",
      comment: "apps/web and apps/api never import each other (§3.3).",
      severity: "error",
      from: { path: "^apps/web/" },
      to: { path: API },
    },
    {
      name: "api-must-not-import-web",
      comment: "apps/web and apps/api never import each other (§3.3).",
      severity: "error",
      from: { path: "^apps/api/" },
      to: { path: WEB },
    },
    {
      name: "web-must-not-import-prisma",
      comment: "apps/web must not import Prisma (§3.3).",
      severity: "error",
      from: { path: "^apps/web/" },
      to: { path: PRISMA },
    },
    {
      name: "shared-packages-must-not-import-prisma",
      comment: "Prisma models never cross the HTTP boundary; rules and contracts carry DTOs only (§3.3).",
      severity: "error",
      from: { path: "^packages/" },
      to: { path: PRISMA },
    },
    {
      name: "api-no-deep-imports-between-modules",
      comment: "Inside apps/api, modules talk through each module's index.ts only (§3.3).",
      severity: "error",
      from: { path: MODULE },
      to: { path: "^apps/api/src/modules/[^/]+/", pathNot: ["^apps/api/src/modules/$1/", `${MODULE}index\\.tsx?$`] },
    },
    {
      name: "api-no-deep-imports-into-modules",
      comment: "Code outside apps/api/src/modules reaches a module through its index.ts only (§3.3).",
      severity: "error",
      from: { path: "^apps/api/", pathNot: "^apps/api/src/modules/" },
      to: { path: "^apps/api/src/modules/[^/]+/", pathNot: `${MODULE}index\\.tsx?$` },
    },
  ],
  options: {
    doNotFollow: { path: ["node_modules", "^apps/api/src/generated/"] },
    exclude: { path: ["(^|/)(dist|coverage)/"] },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      extensions: [".ts", ".tsx", ".d.ts", ".js", ".jsx", ".mjs", ".cjs", ".json"],
    },
  },
};
