// commit-msg hook: the subject line must exist and be short. Nothing else is enforced.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { config } from "./lib.mjs";

const file = process.argv[2] ?? execFileSync("git", ["rev-parse", "--git-path", "COMMIT_EDITMSG"], { encoding: "utf8" }).trim();
if (!file) {
  console.error("usage: commit-msg.mjs <message-file>");
  process.exit(2);
}
const lines = readFileSync(file, "utf8").split(/\r?\n/).filter((l) => !l.startsWith("#"));
const subject = (lines.find((l) => l.trim() !== "") ?? "").trim();

if (!subject) {
  console.error("error: commit message is empty");
  process.exit(1);
}
if (/^(Merge|Revert) /.test(subject)) process.exit(0);
if (subject.length > config.commitSubjectMax) {
  console.error(`error: commit subject is ${subject.length} characters; keep it to ${config.commitSubjectMax} or fewer`);
  process.exit(1);
}
