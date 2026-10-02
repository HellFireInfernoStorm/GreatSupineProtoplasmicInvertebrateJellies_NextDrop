// Labels implied by an issue created from the "Task" form (.github/ISSUE_TEMPLATE/agent-task.yml).
// Used by .github/workflows/issue-labels.yml. Only labels defined in .github/labels.json are returned.
//   node scripts/agent-context/issue-labels.mjs < issue-body.md
import { readFileSync } from "node:fs";
import { config, read, isMain } from "./lib.mjs";

/** Split a rendered issue form into its "### Heading" sections. */
function sections(body) {
  const out = new Map();
  let cur = null;
  for (const line of body.replace(/\r\n/g, "\n").split("\n")) {
    const h = line.match(/^###\s+(.*?)\s*$/);
    if (h) { cur = h[1].toLowerCase(); out.set(cur, []); }
    else if (cur) out.get(cur).push(line);
  }
  return out;
}

export function labelsFromIssueForm(body) {
  const defined = new Set(JSON.parse(read(config.labelsFile)).map((l) => l.name));
  const s = sections(body ?? "");
  const text = (name) => (s.get(name) ?? []).join("\n");
  const found = [];
  for (const name of ["affected services", "type"]) {
    for (const part of text(name).split(/[,\n]/)) {
      const label = part.trim();
      if (defined.has(label)) found.push(label);
    }
  }
  if (/^\s*-\s*\[[xX]\]/m.test(text("designathon departure"))) found.push(config.departureLabel);
  return [...new Set(found)];
}

if (isMain(import.meta.url)) {
  console.log(labelsFromIssueForm(readFileSync(0, "utf8")).join("\n"));
}
