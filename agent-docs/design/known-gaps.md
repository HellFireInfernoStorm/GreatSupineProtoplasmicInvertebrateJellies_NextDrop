---
status: draft
owner: Dinura
sources: design context §10, §11
---

# Other artefacts and known gaps

- **Claude Doc "Dispatcher prototypes — gap review vs Blueprint"** (id `98b3d1fe-3eff-4d9b-ba27-d5ca74462e96`, body block `c37aba05-e5e9`, last revision seen 14): a checklist of the dispatcher screens against the Blueprint, updated with a "Fixes applied · 29 Sep" section; status was 29 Met / 3 Partial per fidelity at the last update, and later evidence updates (T015, 15 run sheets, 83 ETAs, 3 deferral notices).
- **`loader-screens-spec.md`** (repo root): the full Loader spec (foundations, tokens, touch rules, per-screen layout, states, rationale seeds). It marks anything beyond the Blueprint as **[addition]**, notes the Blueprint's "Tablet / phone" should be "Tablet" only, and specifies dark theme, 7:1 contrast, 64/80 px targets, no gesture-only actions, 5 s undo toasts, 40% extra width for Tamil.
- **Datasets** in `mock data/data/General Data/`: `outlets.csv`, `vehicles.csv`, `district_travel.csv`, `calendar.csv`, `road_conditions.csv`, `service_allowance.csv`, `traffic_speed.csv`; Test Data and Training Data folders belong to the Datathon. The Blueprint requires real IDs and district names in the mockups; **our screens still use placeholders** (OUT015, VEH001, T001 etc. are invented).
- **Claude Code memory** at `~/.claude/projects/-home-lakwan-Desktop-RootCode/memory/` (`waypoint-designathon-figma.md`, `figma-mcp-quirks.md`) mirrors much of this file.

---

1. **Wiring gaps:** Dispatcher screens and Store desktop screens have no prototype flows. Store desktop notification popover `438:1358` is not wired to the bell.
2. **Dispatcher degradation story mismatch:** D4's grey card is a Peliyagoda truck in Minuwangoda, while the driver story is the Kandy hill run (Sampath, Talawakele). Missing: D4 "Sync clash" inbox item with the driver's photo, and the escalated (behind schedule) card.
3. **Persona name mismatch:** the Blueprint driver is **Sampath**; the store/dispatcher story uses **Ruwan S.** Decide one.
4. **Real data:** IDs, districts, capacities are placeholders. Blueprint asks for real `OUT0xx`/`VEH0xx` from the CSVs (domain accuracy 10%).
5. **Stale copies:** All Hi-FI page and Style Guide component copies do not include the Store bells/notification panel, degradation frames, login screens or the dispatcher sidebar role label. Refresh before export.
6. **Workflow cards** (Store desktop `252:1311`, Store mobile `252:1500`, Dispatcher `317:1535`, Driver `318:2`, Loader `238:3366`) were built before the degradation and login additions. Update them.
7. **Naming:** Waypoint vs NextDrop unresolved.
8. **Localisation:** Sinhala and Tamil strings (Loader L2, login language chips) need a native check. Noto Sans Sinhala unavailable in Figma, so Yaldevi stands in.
9. **Rationale paragraphs:** the Blueprint requires a one-paragraph rationale per screen. Store desktop dialogs, Loader sections, and the new login screens have them. Dispatcher hi-fi, Driver hi-fi and Store phone screens mostly do **not** have per-screen rationale cards yet.
10. **Not yet on Figma pages:** Blueprint pages 1–3 (cover + problem framing, personas, "A day at Waypoint" diagram), page 9 (trade-off), page 11 (AI disclosure). The Style Guide is done. The video (3–5 min, unlisted YouTube) and zip are outside Figma.
11. **Open Blueprint questions:** confirm degradation scenario; who owns which role; trilingual driver/loader or just a language switch; whether D2 drag-and-drop is buildable by 4 Oct or a list-based version is needed; who records the video and writes the AI disclosure.
12. **Someone else's edits:** extra "Confirm Delivery" / "View order" buttons were added to the Store originals. Confirm these are intended.

---
