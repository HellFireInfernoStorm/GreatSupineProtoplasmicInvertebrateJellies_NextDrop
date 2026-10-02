// Issues named in the "Blocked by" section of a Task-form issue (.github/ISSUE_TEMPLATE/agent-task.yml).
// Used by .github/workflows/unblock.yml to add or remove the `blocked` label.
//   node scripts/agent-context/unblock.mjs < issue-body.md
import { readFileSync } from "node:fs";
import { isMain } from "./lib.mjs";
import { sections } from "./issue-labels.mjs";

export const BLOCKED_LABEL = "blocked";

/** Issue numbers listed under "### Blocked by", in order and without duplicates. Text around them is ignored. */
export function blockersFromIssueBody(body) {
  const text = (sections(body ?? "").get("blocked by") ?? []).join("\n");
  return [...new Set([...text.matchAll(/(?<![\w/])#(\d+)\b/g)].map((m) => Number(m[1])))];
}

/**
 * Whether an open issue should carry the `blocked` label.
 * Returns null when the body names no blocker, so a blocker written as free text is never cleared by accident.
 */
export function shouldBeBlocked(body, isClosed) {
  const blockers = blockersFromIssueBody(body);
  if (!blockers.length) return null;
  return blockers.some((n) => !isClosed(n));
}

if (isMain(import.meta.url)) {
  console.log(blockersFromIssueBody(readFileSync(0, "utf8")).join("\n"));
}
