# ADR 0016: Repository personas over the Figma persona page

- Status: accepted
- Date: 2026-10-02
- Issue / PR: owner decision (Dinura), see the PR that adds this file
- Designathon departure: no

## Context

The Figma page "User Personas" (`510:19782`) describes each role (role, working context, primary goal, key tasks, pain points, information needs) with "Main Features" lists and generated images. It names no persona. For the dispatcher it uses she/her, an age of 34 and six years' experience.

`design/product-and-roles.md` names the personas Dilini, Nimal, Kasun and Sampath. The seed accounts and ADR 0008 depend on these names.

## Decision

The personas in `design/product-and-roles.md` are authoritative: names, role, depot and device. The Figma persona page is supplementary. Its working context, goals and pain points may be used where they do not contradict the repository. Where they conflict (names, the dispatcher's personal details), the repository wins.

Role documents refer to a persona by name or role and do not assign pronouns.

The "Main Features" lists on that page are not a build list in themselves. A feature is built when a drawn screen, flow or rationale in the Figma file shows it, or an issue adds it. The listed features with no drawn screen are tracked in `design/known-gaps.md` for an owner decision.

This may be revisited.

## Alternatives considered

- Adopt the Figma persona page wholesale: drops the names the seed data, walkthrough and screens use.

## Consequences

Edited: `design/product-and-roles.md`, `design/known-gaps.md`.
