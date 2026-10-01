// CI check for pull requests: the template must be filled in, the departure rule must hold, the branch name must fit.
//   GITHUB_EVENT_PATH=<event.json> node scripts/agent-context/check-pr-body.mjs
//   node scripts/agent-context/check-pr-body.mjs path/to/event.json
import { readFileSync } from "node:fs";
import { config, Report } from "./lib.mjs";
import { branchProblem } from "./check-branch.mjs";

const eventPath = process.argv[2] ?? process.env.GITHUB_EVENT_PATH;
if (!eventPath) {
  console.error("error: no event file (set GITHUB_EVENT_PATH or pass a path)");
  process.exit(2);
}
const pr = JSON.parse(readFileSync(eventPath, "utf8")).pull_request;
if (!pr) {
  console.log("pr-body: not a pull_request event, skipping");
  process.exit(0);
}

const r = new Report();
const body = (pr.body ?? "").replace(/\r\n/g, "\n").replace(/<!--[\s\S]*?-->/g, "");
const labels = (pr.labels ?? []).map((l) => l.name);

// Split into "## Heading" sections.
const sections = new Map();
let cur = null;
for (const line of body.split("\n")) {
  const h = line.match(/^##\s+(.*?)\s*$/);
  if (h) { cur = h[1].toLowerCase(); sections.set(cur, []); }
  else if (cur) sections.get(cur).push(line);
}
const section = (name) => (sections.get(name.toLowerCase()) ?? []).join("\n");
const filled = (name) => {
  if (!sections.has(name.toLowerCase())) { r.error(`missing section "## ${name}"`); return ""; }
  const t = section(name).trim();
  if (!t) r.error(`section "${name}" is empty`);
  return t;
};
const boxes = (name) =>
  section(name).split("\n").map((l) => l.match(/^\s*-\s*\[([ xX])\]\s*(.*)$/)).filter(Boolean).map((m) => ({ on: m[1] !== " ", label: m[2] }));

// Closes #N
if (!/\bCloses\s+#\d+/i.test(section("Closes"))) r.error('section "Closes" needs "Closes #<issue number>"');

for (const s of ["Intent", "Key decisions", "Open questions", "How it was tested"]) filled(s);

// Spec and docs
{
  const b = boxes("Spec and docs");
  const on = b.filter((x) => x.on);
  if (!b.length) r.error('section "Spec and docs" has no checkboxes');
  else if (!on.length) r.error('"Spec and docs": tick at least one box');
  for (const x of on) {
    const m = x.label.match(/because:\s*(.*)$/i);
    if (/No spec or docs change needed/i.test(x.label) && !(m && m[1].trim().length >= 4)) r.error('"No spec or docs change needed" must give a reason after "because:"');
  }
}

// Departure from the Designathon design
{
  const b = boxes("Departure from the Designathon design");
  const on = b.filter((x) => x.on);
  const yes = on.some((x) => /^Yes/i.test(x.label));
  const no = on.some((x) => /^No\b/i.test(x.label));
  const hasLabel = labels.includes(config.departureLabel);
  if (on.length !== 1) r.error('"Departure from the Designathon design": tick exactly one of Yes / No');
  if (yes && !hasLabel) r.error(`departure is "Yes" but the PR lacks the label ${config.departureLabel}`);
  if (yes && !/agent-docs\/adr\/\d{4}-[\w-]+/.test(body)) r.error("departure is \"Yes\" but no ADR path (agent-docs/adr/NNNN-slug.md) is linked in the PR");
  if (no && hasLabel) r.error(`the PR has the label ${config.departureLabel} but "No" is ticked`);
}

// Touches
{
  const b = boxes("Touches");
  const on = b.filter((x) => x.on);
  if (!on.length) r.error('"Touches": tick at least one box');
  if (on.some((x) => /packages\/contracts/.test(x.label)) && !labels.includes("contract-change")) r.error("packages/contracts is ticked but the PR lacks the label contract-change");
  if (on.some((x) => /Prisma/.test(x.label)) && !labels.includes("schema-change")) r.error("Prisma schema is ticked but the PR lacks the label schema-change");
}

// AI assistance
{
  const t = filled("AI assistance");
  for (const f of ["Tools and harnesses used", "What the AI produced", "What a human wrote or reviewed"]) {
    const m = t.match(new RegExp(`${f}:[ \\t]*(.*)`));
    if (!m || !m[1].trim()) r.error(`"AI assistance": fill in "${f}" (write None if no AI tool was used)`);
  }
}

const bp = branchProblem(pr.head?.ref);
if (bp) r.error(bp);

r.finish("pr-body");
