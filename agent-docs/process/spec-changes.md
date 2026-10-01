# Changing the spec and recording deviations

The spec in `agent-docs/spec/` says how the system is built. It is a draft that will change.

## The rule

If a change deviates from the spec, or settles something the spec left open, **the same PR adds an ADR and edits the affected spec file**. A PR that changes behaviour without touching the spec or an ADR must say why in the PR template.

- **ADR** (`agent-docs/adr/NNNN-slug.md`, from [0000-template.md](../adr/0000-template.md)): the decision, the alternatives, the reason.
- **Spec edit**: state the new truth in place. Never write "see ADR for the real behaviour".
- **Open questions** live in [spec/open-questions.md](../spec/open-questions.md). When one is settled, remove it there, add the ADR, and edit the spec.

## Status of a spec file

Each file begins with `status: draft | agreed`, `owner`, `sources`.

- `draft`: current best intent. A small edit may skip the ADR if the PR body explains it.
- `agreed`: binding. Any deviation needs an ADR. Only the owner flips a file to `agreed`, by approving the PR that does it.

## Departures from the Designathon design

A departure is anything the Day 5 design specified that the build does differently (a screen, a flow, a label, a layout, a state). Every departure gets:

1. an ADR;
2. the label `designathon-departure` on the issue and the PR;
3. the "Yes" box ticked in the PR template, with the ADR linked.

The README's "significant departures" section is built from the labelled items. Known departures already decided are in [ADR 0002](../adr/0002-known-designathon-departures.md).

## Conflicts with the Booklet

A spec or ADR that contradicts the Booklet is a bug. Open an issue; the Booklet wins until it is fixed.
