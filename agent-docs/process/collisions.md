# Parallel work and collision rules

Each agent or developer works in its own git worktree or branch. These are the places in this repository where parallel work collides.

| Hotspot | Rule |
| --- | --- |
| `packages/contracts` | Contract issues merge first. Dependent issues list them under "Blocked by". Label `contract-change`; one maintainer reviews. |
| Prisma schema and migrations | Label `schema-change`. Before opening the PR, merge `main` and regenerate the migration if another one landed. Hand-written SQL (triggers, partial indexes) lives in the same migration folder. |
| `pnpm-lock.yaml` | Never merge by hand. On conflict, take `main`'s file and run `pnpm i`. |
| Locale files | One JSON file per role and namespace, so two roles' strings never share a file. |
| Seed data | Story fixtures and bulk generation live in separate files. |
| Local stacks | Each worktree gets its own `.env.local` with a unique port and database name, and its own compose project name (`docker compose -p wp-<issue> up`), so containers and migrations do not collide. |

## Ownership by area

Work is partitioned by area (`svc:` labels). Stay inside your issue's area. If you need a change in another area, open an issue for it instead of editing it on the side.

## Orchestrator and workers

An orchestrating agent plans and decomposes into sub-issues. A worker gets one narrow brief: the issue, its linked spec files and its acceptance criteria, not the orchestrator's history.

## Subagents

Use subagents for exploration (reading many files). They return a short summary and keep the main context small. This is a practice, not a requirement of any one harness.
