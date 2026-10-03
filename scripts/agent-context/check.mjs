// Validates the agent context system. Run by the pre-commit and pre-push hooks and by CI.
//   node scripts/agent-context/check.mjs
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve, posix as pp } from "node:path";
import { ROOT, config, Report, frontMatter, trackedFiles, rel } from "./lib.mjs";
import { diffTargets } from "./sync-skills.mjs";
import { expectedReadme, currentReadme } from "./build-index.mjs";

const r = new Report();
const files = trackedFiles().filter((f) => !f.startsWith("node_modules/"));
const text = (f) => readFileSync(join(ROOT, f), "utf8");
const lineCount = (s) => s.replace(/\n$/, "").split("\n").length;

// 1. Every AGENTS.md has a sibling CLAUDE.md that is exactly "@AGENTS.md", and the other way round.
for (const f of files) {
  const base = pp.basename(f);
  const dir = pp.dirname(f);
  if (base === "AGENTS.md") {
    const shim = pp.join(dir, "CLAUDE.md");
    if (!files.includes(shim)) r.error(`${f} has no sibling ${shim} (it must contain exactly "@AGENTS.md")`);
  } else if (base === "CLAUDE.md") {
    if (!files.includes(pp.join(dir, "AGENTS.md"))) r.error(`${f} has no sibling AGENTS.md`);
    else if (text(f).trim() !== "@AGENTS.md") r.error(`${f} must contain exactly "@AGENTS.md"`);
  }
}

// 2. Pointers in instruction files and docs resolve.
const pointerFiles = files.filter(
  (f) =>
    (f.endsWith("AGENTS.md") ||
      (f.startsWith("agent-docs/") && f.endsWith(".md")) ||
      f.startsWith(".agents/skills/") ||
      f === ".github/pull_request_template.md") &&
    !config.sizeExempt.includes(f),
);
const codePrefixes = ["agent-docs/", ".agents/", ".github/", "scripts/"];
for (const f of pointerFiles) {
  const body = text(f).replace(/```[\s\S]*?```/g, "");
  const fromDir = dirname(join(ROOT, f));
  for (const m of body.matchAll(/\]\(([^)\s]+)\)/g)) {
    let target = m[1];
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    target = target.split("#")[0];
    if (target && !existsSync(resolve(fromDir, target))) r.error(`${f}: broken link ${m[1]}`);
  }
  for (const m of body.matchAll(/`([^`\n]+)`/g)) {
    const p = m[1];
    if (!codePrefixes.some((x) => p.startsWith(x))) continue;
    if (/[<>*{}…\s]|\.\.\.|NNNN/.test(p)) continue;
    if (!existsSync(join(ROOT, p.replace(/[:#].*$/, "")))) r.error(`${f}: \`${p}\` does not exist`);
  }
}

// 3. Spec, design and brief files carry a valid header.
for (const f of files) {
  if (!f.endsWith(".md") || f.endsWith("/README.md")) continue;
  if (!config.headerRequiredDirs.some((d) => f.startsWith(d + "/"))) continue;
  const fm = frontMatter(text(f));
  if (!fm) { r.error(`${f}: missing header (status, owner, sources)`); continue; }
  if (!config.headerStatuses.includes(fm.status)) r.error(`${f}: status must be one of ${config.headerStatuses.join(", ")} (got "${fm.status ?? ""}")`);
  if (!fm.owner) r.error(`${f}: header needs owner`);
  if (!fm.sources) r.error(`${f}: header needs sources`);
}

// 4. Soft size limit.
for (const f of files) {
  const isDoc = f.endsWith("AGENTS.md") || (f.startsWith("agent-docs/") && f.endsWith(".md")) || f.endsWith("SKILL.md");
  if (!isDoc || config.sizeExempt.includes(f) || f.startsWith(".claude/")) continue;
  const n = lineCount(text(f));
  if (n > config.softLineLimit) r.warn(`${f} has ${n} lines (soft limit ${config.softLineLimit}); consider splitting it`);
}

// 5. .claude/skills is an exact copy of .agents/skills.
diffTargets().forEach((p) => r.error(p));

// 6. Status table is current.
try {
  if (expectedReadme() !== currentReadme()) r.error("agent-docs/README.md status table is stale (run pnpm agent:index)");
} catch (e) {
  r.error(e.message);
}

// 8. ADR numbers are unique. Parallel branches can pick the same next number; the second to merge renumbers.
const adrByNumber = new Map();
for (const f of files.filter((x) => /^agent-docs\/adr\/\d{4}-.+\.md$/.test(x))) {
  const n = pp.basename(f).slice(0, 4);
  adrByNumber.set(n, [...(adrByNumber.get(n) ?? []), f]);
}
for (const [n, fs] of adrByNumber) {
  if (fs.length > 1) r.error(`ADR number ${n} is used by ${fs.length} files (${fs.join(", ")}); renumber the newer one to the next free number`);
}

// 7. Banned files: organiser datasets and scripts, CSVs outside the approved reference set, env files, keys.
const banned = config.bannedPathPatterns.map((p) => new RegExp(p));
for (const f of files) {
  if (banned.some((re) => re.test(f))) r.error(`${f}: banned path (organiser data, scripts, env files and keys must not be committed)`);
  else if (f.toLowerCase().endsWith(".csv")) {
    const ok = f.startsWith(config.referenceDir + "/") && config.referenceCsvAllowed.includes(pp.basename(f));
    if (!ok) r.error(`${f}: CSV not allowed here. Only ${config.referenceCsvAllowed.join(", ")} under ${config.referenceDir}/ (see agent-docs/spec/platform/data-policy.md)`);
  }
}

r.finish("agent-context");
