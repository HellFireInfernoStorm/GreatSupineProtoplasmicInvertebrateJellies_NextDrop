// pre-push hook: branch name must be <issue-number>-short-slug (main and harness branches are exempt).
import { execFileSync } from "node:child_process";
import { config, globToRegExp, ROOT, isMain } from "./lib.mjs";

export function branchProblem(name) {
  if (!name || name === "HEAD") return null;
  if (config.branchExempt.some((g) => globToRegExp(g).test(name))) return null;
  if (new RegExp(config.branchPattern).test(name)) return null;
  return `branch "${name}" must be named <issue-number>-short-slug, for example 42-publish-transaction`;
}

if (isMain(import.meta.url)) {
  const name = process.env.BRANCH_NAME ?? execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  const problem = branchProblem(name);
  if (problem) {
    console.error(`error: ${problem}`);
    process.exit(1);
  }
}
