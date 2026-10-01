// Rebuilds the document status table in agent-docs/README.md from each file's header.
//   node scripts/agent-context/build-index.mjs          write the table
//   node scripts/agent-context/build-index.mjs --check  exit 1 if it is stale
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, config, frontMatter, trackedFiles, isMain } from "./lib.mjs";

const START = "<!-- status-table:start -->";
const END = "<!-- status-table:end -->";
const README = join(ROOT, "agent-docs/README.md");

export function buildTable() {
  const rows = [];
  for (const f of trackedFiles().sort()) {
    if (!f.endsWith(".md") || !config.headerRequiredDirs.some((d) => f.startsWith(d + "/"))) continue;
    if (f.endsWith("/README.md")) continue;
    const fm = frontMatter(readFileSync(join(ROOT, f), "utf8")) ?? {};
    const link = f.replace(/^agent-docs\//, "");
    rows.push(`| [${link}](${link}) | ${fm.status ?? "?"} | ${fm.owner ?? "?"} |`);
  }
  return `${START}\n\n| Document | Status | Owner |\n| --- | --- | --- |\n${rows.join("\n")}\n\n${END}`;
}

export function currentReadme() {
  return readFileSync(README, "utf8");
}

export function expectedReadme() {
  const text = currentReadme();
  const a = text.indexOf(START);
  const b = text.indexOf(END);
  if (a === -1 || b === -1) throw new Error(`${README} is missing the status-table markers`);
  return text.slice(0, a) + buildTable() + text.slice(b + END.length);
}

if (isMain(import.meta.url)) {
  const next = expectedReadme();
  if (process.argv.includes("--check")) {
    if (next !== currentReadme()) {
      console.error("error: agent-docs/README.md status table is stale (run pnpm agent:index)");
      process.exit(1);
    }
  } else {
    writeFileSync(README, next);
    console.log("updated agent-docs/README.md status table");
  }
}
