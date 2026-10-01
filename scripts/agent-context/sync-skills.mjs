// Copies .agents/skills (the source of truth) into every harness folder in targets.json.
// Real copies, never symlinks, so Windows checkouts and cloud clones work. Targets are generated: do not edit them.
//   node scripts/agent-context/sync-skills.mjs          write the copies
//   node scripts/agent-context/sync-skills.mjs --check  exit 1 if a copy differs (used by check.mjs)
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { ROOT, walk, rel, isMain } from "./lib.mjs";

const cfg = JSON.parse(readFileSync(join(ROOT, "scripts/agent-context/targets.json"), "utf8"));
const NOTE = "GENERATED.md";

const NOTE_TEXT = (src) =>
  `# Generated, do not edit\n\nThis folder is a copy of \`${src}\`, made by \`scripts/agent-context/sync-skills.mjs\`.\nEdit the skill under \`${src}\` and run \`pnpm agent:sync-skills\`. Hand edits here are overwritten and fail CI.\n`;

/** Map of relative path -> content for a directory, ignoring the generated note. */
export function snapshot(dir) {
  const out = new Map();
  if (!existsSync(dir)) return out;
  for (const f of walk(dir)) {
    const r = rel(f).slice(rel(dir).length + 1);
    if (r === NOTE) continue;
    out.set(r, readFileSync(f, "utf8").replace(/\r\n/g, "\n"));
  }
  return out;
}

export function diffTargets() {
  const problems = [];
  const src = snapshot(join(ROOT, cfg.source));
  for (const t of cfg.targets) {
    const dst = snapshot(join(ROOT, t));
    for (const [p, c] of src) {
      if (!dst.has(p)) problems.push(`${t}/${p} is missing (run pnpm agent:sync-skills)`);
      else if (dst.get(p) !== c) problems.push(`${t}/${p} differs from ${cfg.source}/${p} (run pnpm agent:sync-skills; never edit ${t} by hand)`);
    }
    for (const p of dst.keys()) if (!src.has(p)) problems.push(`${t}/${p} has no source in ${cfg.source}`);
    if (!existsSync(join(ROOT, t, NOTE))) problems.push(`${t}/${NOTE} is missing`);
  }
  return problems;
}

function sync() {
  const srcDir = join(ROOT, cfg.source);
  for (const t of cfg.targets) {
    const dst = join(ROOT, t);
    rmSync(dst, { recursive: true, force: true });
    mkdirSync(dst, { recursive: true });
    for (const name of readdirSync(srcDir)) {
      const p = join(srcDir, name);
      if (statSync(p).isDirectory()) cpSync(p, join(dst, name), { recursive: true });
    }
    writeFileSync(join(dst, NOTE), NOTE_TEXT(cfg.source));
    console.log(`synced ${cfg.source} -> ${t}`);
  }
}

if (isMain(import.meta.url)) {
  if (process.argv.includes("--check")) {
    const problems = diffTargets();
    problems.forEach((p) => console.error(`error: ${p}`));
    process.exit(problems.length ? 1 : 0);
  } else sync();
}
