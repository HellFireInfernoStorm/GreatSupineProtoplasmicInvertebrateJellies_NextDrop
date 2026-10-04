---
status: draft
owner: Dinura
sources: design context §10, §11; Figma review of 2 Oct 2026 (ADR 0015)
---

# Other artefacts and known gaps

## What counts as design

The latest Figma file is the only design source (ADR 0015). Anything not in it is not a design requirement:

- Blueprint pages that were never drawn (cover, trade-off page).
- Deleted pages.
- Documents outside this repository: the Blueprint PDF, `loader-screens-spec.md`, and the dispatcher gap-review Claude Doc.

None of these is tracked as a gap. The Loader rules the build needs are in `design-system.md` §3.2 and §3.6–3.7, and in the Figma rationale cards. Tamil string length is handled by `spec/frontend/design-system.md` (layouts must not assume English widths; a Playwright check renders `ta` at phone width).

The NextDrop wordmark exists only as raster images, and there is no vector source. The raster is the asset (`figma-reference.md` §4.5).

Datasets: the reference CSVs go in `data/reference/` (ADR 0011). Real IDs replace the design's placeholders (ADR 0008).

## Open gaps (as of the Figma review, 2 Oct)

1. **The dispatcher side of the degradation story is incomplete.**
   - D4's grey card is T002 · VEH004 · Gampaha ("low-coverage area near Minuwangoda"), not the Kandy trip.
   - Not drawn: a "Sync clash" item in the D4 inbox (recovery rule 3), and the escalated (behind schedule) state.
   - The build retargets the card to the Kandy fixture and adds both states in the D4 visual language (ADR 0008 amendment; `degradation-scenario.md` §7.3). Built in #61: the grey card is whichever run the API reports `NO_SIGNAL` or `ESCALATED`, so no trip is hard-coded.
2. **The story data is inconsistent across apps.**
   - Store, Dispatcher and Loader use Peliyagoda, T001, VEH001 and Ruwan S. with real-looking IDs.
   - Driver uses Kandy and Sampath with `OUT0xx` placeholders, and names loader Kasun on the "Kandy dock".
   - The build follows ADR 0008: one Kandy fixture for the field steps, with a separate Kandy loader account.
3. **Workflow cards are stale.** Dispatcher `317:1535`, Store `252:1311` / `252:1500` and Driver `318:2` say "not wired yet", but all four are wired. The Store and Driver cards do not include the degradation flow or login.
4. **Localisation.** The Sinhala and Tamil strings (Loader L2, login language chips) need a native check. Yaldevi stands in for Noto Sans Sinhala in Figma.
5. **Figma defects**, not fixed while the file is frozen: `figma-reference.md` §4.10.
6. **Persona-page features with no drawn screen** (ADR 0016). They are not built unless the owner or an issue adds them:
   - Store: "Order tracking (status, **location**)". This conflicts with the decision to leave out live GPS.
   - Dispatcher: "Vehicle and **driver** assignment" (rosters were left out) and "Trip history".
   - Loader: "Loading and shortfall history".
7. **Ownership.** Role owners will be decided at a team meeting. Who records the video will be decided after development, based on availability. The Designathon AI disclosure exists in Figma (`559:19610`) and becomes part of `docs/ai-disclosure.md`.

## Closed by the Figma review or by ADRs

| Former item | Resolution |
| --- | --- |
| Dispatcher and Store desktop not wired; store popover not on the bell | All wired (`prototype-flows.md`). The store desktop popover still cannot be closed (§4.10). |
| Driver name: Sampath or Ruwan S. | ADR 0008 |
| Placeholder IDs vs real data | ADR 0008. Fixtures are picked from the CSVs. |
| All Hi-FI and Style Guide copies stale | Refreshed. Remaining defects are in `figma-reference.md` §4.10. |
| Workflow cards predate degradation and login | Partly. See open item 3. |
| Naming: Waypoint vs NextDrop | ADR 0012. The NextDrop wordmark is in the Style Guide Logos section. |
| Rationale paragraph per screen | Complete for every hi-fi screen, modal and popover. |
| Personas, "a day at Waypoint" diagram, AI disclosure missing from Figma | Pages `510:19782`, `510:19850`, `559:19610` |
| D2 drag-and-drop buildable? | ADR 0002: "Move to…" menus, drag optional |
| Extra "Confirm Delivery" / "View order" buttons added by someone else | Present in the latest file, which is the source of truth (ADR 0015). Build them. |
| Hi-fi constraint-breach modal missing | It exists: `293:1995` |
