---
status: draft
owner: Dinura
sources: design context §10, §11; Figma review of 2 Oct 2026 (ADR 0015)
---

# Other artefacts and known gaps

## Artefacts outside this repository

These are held by Chethaka (`@lakwan194`), who wrote the design context. Copies have been requested.

- **Claude Doc "Dispatcher prototypes — gap review vs Blueprint"** (id `98b3d1fe-3eff-4d9b-ba27-d5ca74462e96`, body block `c37aba05-e5e9`, last revision seen 14). A checklist of the dispatcher screens against the Blueprint. It stood at 29 Met / 3 Partial on 29 Sep.
- **`loader-screens-spec.md`**. The full Loader spec. Its rules that are confirmed elsewhere:
  - 7:1 contrast (`design-system.md` §3.2).
  - 64/80 px targets and no gesture-only actions (§3.6, §3.7).
  - 5 s undo toasts (Figma Loader workflow card and Style Guide).

  The 40% extra width for Tamil is known only from that file.
- **`Designation Blueprint.pdf`** (13 pages). It binds only through what this folder captured from it. The Booklet always wins.
- **Datasets.** The reference CSVs go in `data/reference/` (ADR 0011). Real IDs replace the design's placeholders (ADR 0008).

## Open gaps (as of the Figma review, 2 Oct)

1. **The dispatcher side of the degradation story is incomplete.**
   - D4's grey card is T002 · VEH004 · Gampaha ("low-coverage area near Minuwangoda"), not the Kandy trip.
   - Not drawn: a "Sync clash" item in the D4 inbox (recovery rule 3), and the escalated (behind schedule) state.
   - The build retargets the card to the Kandy fixture and adds both states in the D4 visual language (ADR 0008 amendment; `degradation-scenario.md` §7.3).
2. **The story data is inconsistent across apps.**
   - Store, Dispatcher and Loader use Peliyagoda, T001, VEH001 and Ruwan S. with real-looking IDs.
   - Driver uses Kandy and Sampath with `OUT0xx` placeholders, and names loader Kasun on the "Kandy dock".
   - The build follows ADR 0008: one Kandy fixture for the field steps, with a separate Kandy loader account.
3. **Workflow cards are stale.** Dispatcher `317:1535`, Store `252:1311` / `252:1500` and Driver `318:2` say "not wired yet", but all four are wired. The Store and Driver cards do not include the degradation flow or login.
4. **Localisation.** The Sinhala and Tamil strings (Loader L2, login language chips) need a native check. Yaldevi stands in for Noto Sans Sinhala in Figma.
5. **Blueprint pages not found in Figma:** cover / problem framing, and the trade-off page (Blueprint p9). The trade-off is written in `product-and-roles.md`.
6. **Figma defects**, not fixed while the file is frozen: `figma-reference.md` §4.10.
7. **Persona-page features with no drawn screen** (ADR 0016). They are not built unless the owner or an issue adds them:
   - Store: "Order tracking (status, **location**)". This conflicts with the decision to leave out live GPS.
   - Dispatcher: "Vehicle and **driver** assignment" (rosters were left out) and "Trip history".
   - Loader: "Loading and shortfall history".
8. **Ownership.** Role owners will be decided at a team meeting. Who records the video will be decided after development, based on availability. The Designathon AI disclosure exists in Figma (`559:19610`) and becomes part of `docs/ai-disclosure.md`.

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
