# NextDrop (Tech-Triathlon 2026, Hackathon build)

Delivery planning system (product name NextDrop) for Waypoint Group: one responsive PWA with four role shells (store manager, dispatcher, loader, driver) over one modular-monolith API and one PostgreSQL database. Every order is one record with a timeline that all four roles read and append to.

Instruction files are owned by Dinura (`@HellFireInfernoStorm`). Propose changes by PR.

## Precedence

When sources disagree, the higher one wins:

1. The Challenge Booklet: `agent-docs/brief/challenge-booklet.md`.
2. Accepted ADRs: `agent-docs/adr/`.
3. The spec: `agent-docs/spec/`. For what a screen looks like, `agent-docs/design/` wins over the spec.
4. The nested `AGENTS.md` of the directory you are editing.
5. The issue's acceptance criteria.
6. Personal files (`AGENTS.local.md`). They never override the repository.

If an issue contradicts a higher source, stop and comment on the issue. Do not pick a side silently. A spec that contradicts the Booklet is a bug: open an issue.

## Commands

```
pnpm i                      install (also installs the git hooks via lefthook)
pnpm dev | typecheck | lint | test | test:int | e2e     defined by the monorepo skeleton
docker compose up           whole stack: database, migrations, seed, app
pnpm agent:check            validate instruction files, spec headers, skills copies, banned paths
pnpm agent:sync-skills      copy .agents/skills/ into .claude/skills/
pnpm agent:index            rebuild the status table in agent-docs/README.md
```

## Boundaries

- Rules live only in `packages/rules`. Never re-implement a constraint in the API or the UI.
- `apps/web` and `apps/api` never import each other. Both may import `packages/rules` and `packages/contracts`.
- Never skip git hooks (`--no-verify`). Fix the check instead.
- Never commit dataset files other than the approved reference CSVs in `data/reference/`, never commit secrets or `.env`. The hooks block this.
- Never edit `.claude/skills/`. Edit `.agents/skills/` and run `pnpm agent:sync-skills`.
- No new container, service or major dependency without an ADR.
- Every user-facing string uses an i18n key. Every displayed time is server-clock aware.

## Starting a task

Follow [agent-docs/process/start-task.md](agent-docs/process/start-task.md). In short: read the issue and its comments (use `gh`, or the GitHub MCP tools if `gh` is missing: [github-access.md](agent-docs/process/github-access.md)), create branch `<issue-number>-short-slug`, post your plan as an issue comment starting with `<!-- agent-plan -->`, and keep that comment current.

## Changing the spec

If a change deviates from the spec, or settles something it leaves open, the same PR adds an ADR and edits the spec file. See [spec-changes.md](agent-docs/process/spec-changes.md). Departures from the Day 5 Designathon design also get the label `designathon-departure`.

## Where to look

| You are working on | Read first |
| --- | --- |
| Anything | [agent-docs/README.md](agent-docs/README.md), [spec/overview.md](agent-docs/spec/overview.md) |
| `apps/api` | its `AGENTS.md`, then `spec/planning`, `spec/sync`, `spec/events`, `spec/data`, `spec/platform` |
| `apps/web` | its `AGENTS.md`, then `spec/frontend`, `spec/sync/offline-client.md`, `design/` |
| `packages/rules` | its `AGENTS.md`, then `spec/rules-core`, `spec/domain` |
| `packages/contracts` | its `AGENTS.md`, then `spec/events` |
| `e2e` | its `AGENTS.md`, then `spec/data/seed-and-demo.md` |
| PRs, commits, hooks | [pr-and-commits.md](agent-docs/process/pr-and-commits.md), [hooks.md](agent-docs/process/hooks.md) |
| Parallel work | [collisions.md](agent-docs/process/collisions.md) |

Spec files marked `status: draft` are the current best intent and may change. If merged code and a draft disagree, raise an issue instead of choosing.

## Local overrides

`AGENTS.local.md` and `CLAUDE.local.md` are git-ignored, for personal preferences only.
