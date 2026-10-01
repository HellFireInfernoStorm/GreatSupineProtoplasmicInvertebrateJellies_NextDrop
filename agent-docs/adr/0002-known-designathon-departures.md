# ADR 0002: Known departures from the Designathon design

- Status: accepted
- Date: 2026-10-01
- Issue / PR: initial setup
- Designathon departure: yes (label `designathon-departure`)

## Context

The Booklet says judges assess the Driver and Loader on phone-sized screens. The submitted design draws the Loader for a landscape tablet only. The design also used stand-in fonts and assumed drag-and-drop planning.

## Decision

1. **Loader phone layout.** The Loader has a single-column phone layout in addition to the tablet design (see [frontend design-system](../spec/frontend/design-system.md)).
2. **Sinhala and Tamil fonts.** Noto Sans Sinhala and Noto Sans Tamil, self-hosted, replace the Yaldevi stand-in used in Figma.
3. **Planning interaction.** Assign and move through "Move to…" menus backed by the validator. Drag-and-drop is optional polish.

Each item is listed in the README's "significant departures" section.

## Alternatives considered

- Tablet-only Loader: risks failing the phone assessment in the Booklet.

## Consequences

New departures are added as further ADRs with the `designathon-departure` label. Spec files affected: `spec/frontend/design-system.md`.
