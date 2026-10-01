---
name: change-spec
description: Change the spec, record a deviation, or settle an open question. Use when behaviour differs from agent-docs/spec or a design departure is needed.
---

Follow `agent-docs/process/spec-changes.md`.

1. Add `agent-docs/adr/NNNN-slug.md` from `agent-docs/adr/0000-template.md`.
2. Edit the affected spec file in the same PR, stating the new truth in place.
3. If it settles an entry in `agent-docs/spec/open-questions.md`, remove that entry.
4. If it departs from the Day 5 design: put the label `designathon-departure` on the issue and PR, and tick "Yes" in the PR template.
5. Do not change a spec file's `status` to `agreed` yourself. The owner approves that.
