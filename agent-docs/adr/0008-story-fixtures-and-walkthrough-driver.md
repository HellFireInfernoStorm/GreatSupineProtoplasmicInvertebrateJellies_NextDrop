# ADR 0008: Story fixtures and the walkthrough driver

- Status: accepted
- Date: 2026-10-02
- Issue / PR: owner decision (Dinura), see the PR that adds this file
- Designathon departure: yes (label `designathon-departure`)

## Context

The design uses invented IDs (`OUT015`, `VEH001`, `T001`) and two driver stories: Ruwan S. from Peliyagoda for store and dispatcher, Sampath on the Kandy hill run for the driver and the degradation scene. The Booklet asks for real IDs and district names.

## Decision

Sampath on a Kandy-depot vehicle, with the low-coverage hill run, is the single walkthrough driver. Ruwan S. stays as a second account. All story fixtures (store outlet, vehicle, driver, trip, orders) are chosen from the reference CSVs by a script using the criteria in `data/seed-and-demo.md` and pinned in one `story-fixtures` module that seed, e2e tests and docs share. The dispatcher's 'no signal' card and the store's delayed-confirmation view use that same driver and trip. The design's invented IDs are replaced by the real ones.

## Alternatives considered

- Keep Ruwan and Peliyagoda: not the scenario the driver screens are drawn for.
- Change the story to whatever the data allows: loses the Fresh, reefer and hill-run elements.

## Consequences

The Figma frames for store and dispatcher show different names and IDs until refreshed. This is listed as a departure. Spec edited: `data/seed-and-demo.md`, `overview.md`, `assumptions.md`.
