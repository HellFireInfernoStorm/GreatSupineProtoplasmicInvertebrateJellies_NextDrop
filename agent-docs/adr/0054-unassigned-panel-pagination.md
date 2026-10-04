# ADR 0054: Page the Plan board Unassigned panel

- Status: proposed
- Date: 2026-10-04
- Issue / PR: #126
- Designathon departure: yes

## Context

The live Dispatcher Hi-fi D2 frame `254:9213` in file `BUan1C6oFA7OTc9o6cCQxv` was inspected on 4 Oct 2026, including its Unassigned node `269:1091`. The 1600x1000 design has a 340x722 right side that scrolls vertically. Unassigned also scrolls internally, shows four compact example rows with a total of five, and has a Review unassigned orders button. It has no pagination controls.

The current build renders all unassigned cards, each with the existing Move to menu. A browser comparison with 37 contract-based order fixtures at 1600x1000 measured a 5,547 px Unassigned panel. A temporary 560 px internal scrolling version kept the panel bounded but retained roughly 5,545 px of scrollable content inside the already scrolling workspace. The first four existing interactive cards occupied about 555 px, before the panel heading, gaps and navigation.

[Issue #126](https://github.com/HellFireInfernoStorm/GreatSupineProtoplasmicInvertebrateJellies_NextDrop/issues/126) asks for bounded height, deterministic access to every order, clear counts and accessible controls. The Figma comparison uses the live design as required by [ADR 0015](0015-live-figma-is-design-source.md).

## Decision

Use client-side pagination with four Unassigned cards per page on desktop, tablet and phone. Four is a count bound rather than a fixed pixel height: cards and translated controls may wrap without clipping, and a partial last page may be shorter. Retain the heading's full Unassigned total. Show Previous and Next plus an announced visible range such as `1–4 of 37`; an empty list has range `0–0 of 0` and the existing empty message. Disable Previous at the first page and Next at the last page, including both for zero or one page. Keep the existing queue order; slicing does not reorder, discard or duplicate orders.

Within the same depot/day/draft, clamp the current index after moves or refreshes so a nonempty list never displays an empty page. A new scope starts at page zero. Existing keyed Workspace and PlanBoard remounts supply depot/day/draft resets; the pure helper also resets when its scope key changes. Paging is presentation only and leaves move menus, allocation, sequence, validation, plan assignments and API contracts unchanged.

Keep paging controls outside the card list with labels and a polite, atomic count announcement. After an explicit page change, focus the Unassigned heading so keyboard users reach the new page's cards in order; after a saved move removes the focused card, return focus to that heading. Passive refresh must not steal focus from elsewhere. Reuse the existing fixed dispatcher shell: the main workspace scrolls, with no additional scroll area inside Unassigned. Cards and controls wrap at narrow widths without horizontal page overflow.

## Alternatives considered

- Bound the full list with internal scrolling: closest to Figma and avoids page changes, but creates a nested scroll region and leaves progress through crowded data implicit. The browser comparison confirmed that 37 interactive cards still occupy over 5,500 px within that region.
- Render every card in the main workspace: retains the current interaction but makes panel height proportional to the entire list.
- Infinite scrolling or API pagination: unnecessary state and contract changes for a locally available draft; outside this issue's scope.
- Vary page size by viewport: more resize/focus state for little benefit. Four wrapping cards remain reachable on narrow screens through the existing workspace scroll.

## Consequences

The panel height no longer grows with the number of unassigned orders. Explicit range/total and boundary buttons make progress visible, with a page switch cost for lists beyond four. Focus and page-index behavior need regression tests and browser verification at 375 px, tablet and desktop widths.

The same PR updates `design/screens.md`, `spec/planning/flow.md` and `spec/frontend/architecture.md`. The implementation remains confined to the Unassigned rendering in PlanBoard.tsx, scoped dispatcher.css rules, a small pure paging helper with its own tests, and `unassignedPaging.*` keys in dispatcher/planning.json. No changes to planning.ts, Move to menu, trip sequence, #60/#63 files, or walkthrough tests.
