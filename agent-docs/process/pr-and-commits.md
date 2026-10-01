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
- any of the three AI assistance fields is empty (write `None` if no AI tool was used).

### AI assistance section

The Booklet requires a disclosure of which work was AI-assisted, which was not, and how the tools were used. Fill the section for every PR: tools and harnesses, what the AI produced, what a human wrote or reviewed. Dinura compiles `docs/ai-disclosure.md` from these.

## Labels

Defined once in `.github/labels.json` and applied by the `labels` workflow.

| Label | Use |
| --- | --- |
| `svc:api` `svc:web` `svc:rules` `svc:contracts` `svc:e2e` `svc:solver` `svc:infra` `svc:docs` | Which part of the system an issue touches |
| `type:feature` `type:bug` `type:chore` `type:spike` | One per issue |
| `designathon-departure` | Issue or PR that changes something the Day 5 design specified. The README's "significant departures" section is built from these. |
| `contract-change` | Touches `packages/contracts` events or DTOs |
| `schema-change` | Touches Prisma schema or migrations |
| `blocked` | Waiting on another issue named in the body |
