---
name: triage-issue
description: Turn a rough request into a complete, agent-ready GitHub issue with sub-issues. Use when asked to write, split or triage issues.
---

An issue is a task brief. Every issue needs the fields in `.github/ISSUE_TEMPLATE/agent-task.yml`: goal, affected services, acceptance criteria, out of scope, docs and ADRs to read.

1. Read the relevant spec area and the nested `AGENTS.md` files before writing.
2. Make each issue narrow and independently assignable. Split large features into sub-issues.
3. Put contract and schema issues first (labels `contract-change`, `schema-change`) and list them under "Blocked by" in dependants.
4. Apply one `svc:*` label per area touched and exactly one `type:*` label. Add `designathon-departure` if it changes the Day 5 design. The Task form applies these from its fields. An issue created through `gh` or the API does not, so pass the labels when creating it. PRs inherit them and CI fails a PR without them.
5. Link, do not copy, spec text.
6. Reach GitHub as described in `agent-docs/process/github-access.md`.
