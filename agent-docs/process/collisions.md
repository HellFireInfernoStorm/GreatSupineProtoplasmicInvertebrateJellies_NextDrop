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

## Merge gatekeeper

Dinura (`@HellFireInfernoStorm`) merges every PR into `main`. Authors open the PR and keep it green; they do not merge it. The gatekeeper:

- **Orders merges.** Contract and schema PRs go before the PRs that depend on them. A PR whose "Blocked by" issues are still open waits.
- **Checks before merging.** CI is green. A `contract-change` PR is approved by the contracts maintainer, and a `schema-change` PR has `main` merged in with its migration regenerated. A deviation from the spec carries an ADR and the spec edit ([spec-changes.md](spec-changes.md)).
- **Squash-merges** with the PR title as the subject, ending `(#N)`, and deletes the branch.
- **Keeps `main` green.** If `main` breaks, merging stops until the breaking PR is reverted or fixed.
- **Settles conflicts.** Asks the author to merge `main` into the branch (never rebase or force-push someone else's branch). A lockfile conflict follows the `pnpm-lock.yaml` rule above.
- **Enforces the freeze.** After 20:00 on Sun 4 Oct (Asia/Colombo), only walkthrough fixes and submission docs merge. Nothing merges after 23:59.

The `blocked` label is cleared automatically when every issue under "Blocked by" closes ([pr-and-commits.md](pr-and-commits.md)).

## Ownership by area

Work is partitioned by area (`svc:` labels). Stay inside your issue's area. If you need a change in another area, open an issue for it instead of editing it on the side.

## Orchestrator and workers

An orchestrating agent plans and decomposes into sub-issues. A worker gets one narrow brief: the issue, its linked spec files and its acceptance criteria, not the orchestrator's history.

## Subagents

Use subagents for exploration (reading many files). They return a short summary and keep the main context small. This is a practice, not a requirement of any one harness.
