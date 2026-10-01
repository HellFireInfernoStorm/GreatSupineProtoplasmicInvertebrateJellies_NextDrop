// Shared helpers for the agent-context scripts. Node 22, no dependencies.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, dirname, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const config = JSON.parse(readFileSync(join(ROOT, "scripts/agent-context/config.json"), "utf8"));

/** True when the importing module is the script being run, not merely imported. */
export const isMain = (url) => Boolean(process.argv[1]) && pathToFileURL(resolve(process.argv[1])).href === url;

export const posix = (p) => p.split(sep).join("/");
export const rel = (abs) => posix(relative(ROOT, abs));
export const read = (relPath) => readFileSync(join(ROOT, relPath), "utf8");

/** Tracked files (includes staged additions). Falls back to a directory walk outside git. */
export function trackedFiles() {
  try {
    const out = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: ROOT, encoding: "utf8" });
    return out.split("\0").filter(Boolean).filter((f) => existsSync(join(ROOT, f)));
  } catch {
    return walk(ROOT).map(rel);
  }
}

export function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === ".git" || name === "node_modules") continue;
    const p = join(dir, name);
    statSync(p).isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
}

/** Parse a leading `---` front matter block of simple `key: value` lines. */
export function frontMatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!m) return null;
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (kv) data[kv[1]] = kv[2].replace(/\s+#.*$/, "").trim();
  }
  return data;
}

export function globToRegExp(glob) {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${esc}$`);
}

export class Report {
  errors = [];
  warnings = [];
  error(msg) { this.errors.push(msg); }
  warn(msg) { this.warnings.push(msg); }
  finish(name) {
    for (const w of this.warnings) console.warn(`warning: ${w}`);
    for (const e of this.errors) console.error(`error: ${e}`);
    if (this.errors.length) {
      console.error(`\n${name}: ${this.errors.length} error(s), ${this.warnings.length} warning(s)`);
      process.exit(1);
    }
    console.log(`${name}: ok${this.warnings.length ? ` (${this.warnings.length} warning(s))` : ""}`);
  }
}
