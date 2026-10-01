# ADR 0001: Agent context system

- Status: accepted
- Date: 2026-10-01
- Issue / PR: initial setup
- Designathon departure: no

## Context

The team has several developers on different tools and agentic harnesses. The architecture guide is a draft that will keep changing, and one long file does not suit agents that need only part of it.

## Decision

- `AGENTS.md` is the canonical instruction file, at the root and in each package. Each has a one-line `CLAUDE.md` shim (`@AGENTS.md`) beside it.
- Agent context lives in `agent-docs/` (`docs/` is reserved for the competition submission). The architecture guide is split into `agent-docs/spec/` by concern, the design context into `agent-docs/design/`, and the Challenge Booklet is committed unchanged in `agent-docs/brief/`.
- Precedence: Booklet, accepted ADRs, spec (design wins on visuals), nested `AGENTS.md`, issue criteria, personal files.
- A deviation from the spec gets an ADR and a spec edit in the same PR. Departures from the Day 5 design also get the label `designathon-departure`.
- GitHub issues are task briefs, labelled `svc:*` and `type:*`. In-flight state is one agent-maintained issue comment. The PR is the handoff and carries the AI-assistance disclosure.
- Skills: `.agents/skills/` is the source of truth. `.claude/skills/` is always a copy made by `scripts/agent-context/sync-skills.mjs`, never edited by hand and never a symlink.
- Enforcement is by git hooks (lefthook) mirrored in CI. No harness-specific hooks.
- Dinura owns all instruction files (CODEOWNERS).
- Size limit for instruction files and docs is 300 lines, as a soft warning.

## Alternatives considered

- Symlinks for skills: break on Windows checkouts.
- Harness-specific hooks: protect only one tool.
- A single guide file: forces every agent to load everything.

## Consequences

Contributors must keep the spec current in the same PR as the code. The check script and PR template make omissions visible.
