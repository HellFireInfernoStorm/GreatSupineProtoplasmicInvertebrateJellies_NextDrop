# Git hooks and CI checks

Enforcement is by git hooks (lefthook), not by harness-specific hooks, so every developer and every agent harness hits the same checks. CI runs the same checks and is the backstop, because a hook can be skipped. Never use `--no-verify`.

`pnpm i` installs the hooks (the `prepare` script runs `lefthook install`). Configuration is `lefthook.yml`; the scripts are in `scripts/agent-context/`.

| Stage | What runs |
| --- | --- |
| `pre-commit` | `sync-skills.mjs` (refresh `.claude/skills/`), `build-index.mjs` (refresh the status table), `check.mjs`, then Prettier (writes and re-stages) and ESLint on the staged source files |
| `commit-msg` | `commit-msg.mjs`: subject present and at most 72 characters |
| `pre-push` | `check-branch.mjs`, `check.mjs`, then `typecheck` and `test` for any package that defines them, and the root `deps:check` (module boundaries) |
| CI | `ci.yml` on every PR and push to `main`: cached pnpm install, `typecheck`, `lint`, `deps:check`, `test`, `test:int` against a PostgreSQL 16 service, `build`, and a Compose smoke job (`docker compose up`, then `/api/readyz` and the PWA). `agent-context.yml`: `check.mjs`, and on pull requests `check-pr-body.mjs` (PR sections, departure rule, required labels, branch name). On issues, the `issue-labels` workflow applies the labels chosen in the Task form (`issue-labels.mjs`), and the `unblock` workflow keeps the `blocked` label in step with each issue's "Blocked by" list (`unblock.mjs`). |

## What `check.mjs` verifies

- Every `AGENTS.md` has a sibling `CLAUDE.md` containing exactly `@AGENTS.md`, and every `CLAUDE.md` has an `AGENTS.md`.
- Relative markdown links and `agent-docs/`, `.agents/`, `.github/`, `scripts/` paths in instruction files and docs resolve.
- Every file under `spec/`, `design/` and `brief/` (except `README.md`) has a valid header.
- `.claude/skills/` is an exact copy of `.agents/skills/`.
- The status table in `agent-docs/README.md` is current.
- Every ADR number in `agent-docs/adr/` is used once. When parallel branches pick the same number, the second to merge renumbers.
- No banned files are tracked: organiser datasets, CSVs outside `data/reference/` (allow-list), `.env`, keys.
- Size: instruction files, spec, design and process docs over 300 lines produce a warning (soft limit, never a failure).

Configuration (limits, allow-lists, branch patterns) is in `scripts/agent-context/config.json`.

## Adding checks

Prefer a check over a new sentence in an instruction file. If a rule can be enforced by a hook, lint rule or test, add that instead and keep the prose short. Module boundaries ([stack-and-layout.md](../spec/platform/stack-and-layout.md) §3.3) are dependency-cruiser rules in `.dependency-cruiser.js`, run by `pnpm deps:check` in the pre-push hook and in CI.
