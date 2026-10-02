# Pull requests, commits and labels

## Branches

`<issue-number>-short-slug`, lowercase, hyphens. `main` and harness-assigned `claude/*` branches are exempt. The pre-push hook and CI check the name (patterns live in `scripts/agent-context/config.json`).

## Commits stay plain

- One imperative subject line of 72 characters or fewer, for example `Add publish transaction`. Optional body.
- No commit template and no required trailers. Trailers added by a harness are allowed.
- The `commit-msg` hook checks the subject length and that it is not empty.

## Pull requests

The PR is the handoff unit, so the template is strict. Sections and checkboxes are in `.github/pull_request_template.md`. CI (`agent-context.yml`) fails the PR if:

- there is no `Closes #N`;
- Intent, Key decisions, Open questions or How it was tested are empty;
- none of the "Spec and docs" boxes is ticked, or "No spec or docs change needed" has no reason after "because:";
- the departure choice is missing, or "Yes" is ticked without the label `designathon-departure` and an ADR link (and vice versa);
- no "Touches" box is ticked;
- any of the three AI assistance fields is empty (write `None` if no AI tool was used);
- the labels are wrong: see the next section.

### AI assistance section

The Booklet requires a disclosure of which work was AI-assisted, which was not, and how the tools were used. Fill the section for every PR: tools and harnesses, what the AI produced, what a human wrote or reviewed. Dinura compiles `docs/ai-disclosure.md` from these.

## Labels

Defined once in `.github/labels.json` and created by the `labels` workflow.

**Every PR needs labels, and CI fails without them.** Labels are not part of the PR body, so set them separately:

- At least one `svc:*` label, one per area touched.
- Exactly one `type:*` label.
- `designathon-departure`, `contract-change` or `schema-change` whenever the PR template says so.

Copy the labels from the issue the PR closes, then adjust them to what the PR actually touches.

A PR opened from a UI or by a tool that does not set labels (for example the Claude Code "create PR" button or `create_pull_request`) starts unlabelled. Add the labels straight after opening it (`gh pr edit N --add-label …`, or MCP `issue_write` with the PR number). Every label change re-runs the check.

Issues follow the same rule. The "Task" form applies its `svc:*`, `type:*` and departure labels automatically (`issue-labels` workflow). An issue created without the form, through `gh issue create` or the API, needs its labels set by whoever creates it.

| Label | Use |
| --- | --- |
| `svc:api` `svc:web` `svc:rules` `svc:contracts` `svc:e2e` `svc:solver` `svc:infra` `svc:docs` | Which part of the system an issue touches |
| `type:feature` `type:bug` `type:chore` `type:spike` | One per issue |
| `designathon-departure` | Issue or PR that changes something the Day 5 design specified. The README's "significant departures" section is built from these. |
| `contract-change` | Touches `packages/contracts` events or DTOs |
| `schema-change` | Touches Prisma schema or migrations |
| `blocked` | Waiting on another issue named in the body |
