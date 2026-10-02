# ADR 0015: The live Figma file is the design source of truth

- Status: accepted
- Date: 2026-10-02
- Issue / PR: owner decision (Dinura), see the PR that adds this file
- Designathon departure: no

## Context

`agent-docs/design/` was written from a design-context file (last updated 30 Sep) without access to the Figma file. A read-only review of the live file on 2 Oct found it had moved on:

- Three new pages: User Personas, Delivery Cycle Diagram, AI Tool Disclosure.
- A NextDrop wordmark.
- Dispatcher toasts and a notifications popover.
- A refreshed All Hi-FI page.
- Renamed frames.
- Prototype wiring for the Dispatcher and Store desktop.

`spec/assumptions.md` listed "which Designathon snapshot was submitted" as open. The Booklet scores fidelity to the Day 5 design but does not say how to identify it.

## Decision

The **latest version** of the Figma file `BUan1C6oFA7OTc9o6cCQxv` is the design source of truth for the build. The team does not reconstruct the 29 Sep snapshot from version history.

`agent-docs/design/` is the repository's written summary of that file. When a design doc and the live file disagree on what a screen shows, the live file wins and the doc is corrected. The precedence rule in the root `AGENTS.md` names the live file accordingly.

Above design, the order is unchanged: the Booklet, then accepted ADRs, then the spec. Where an ADR departs from the file, for example the product name (ADR 0012), real IDs (ADR 0008) or m³ capacity (ADR 0010), the ADR wins and the departure is listed in the README.

The Figma file is **not edited for now**. Known defects in the file are recorded in `design/figma-reference.md` and `design/known-gaps.md`, so builders do not copy them.

## Alternatives considered

- Reconstruct the 29 Sep snapshot from Figma version history: slow, and it discards finished work (personas, toasts, wordmark) the team wants in the build.
- Keep `agent-docs/design/` as the source and ignore the live file: the docs were already stale on screen names and node IDs.

## Consequences

- The open item about the submitted snapshot in `spec/assumptions.md` is settled.
- Edited: `AGENTS.md`, `spec/assumptions.md`, `spec/frontend/architecture.md` (screen inventory), every file in `design/` that the review found stale.
- A later edit to the Figma file can change the build target. Such an edit should be announced to the team and followed by a doc update.
