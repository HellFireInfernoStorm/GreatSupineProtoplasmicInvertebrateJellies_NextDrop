---
status: draft
owner: Dinura
sources: design context §4, §12, §13
---

# Figma file map and tooling notes

Pages currently in the file (listed with `figma.root.children` on 30 Sep; the MCP page listing without a nodeId only showed one page, so always list via `use_figma`):

| Page | ID | What is on it |
|---|---|---|
| All Hi-FI | `367:9318` | 63 static copies of every app's main screens, **no flows** (predates later additions) |
| Dispatcher Hi-Fi | `254:8156` | Our Dispatcher work. It was created as "Dispatcher Hi-Fi Claude", was renamed "Page 1", and is now "Dispatcher Hi-Fi". |
| Driver Hi-Fi | `297:6641` | Driver low-fi + hi-fi + degradation + login |
| Store Manager HI-Fi Claude | `197:5305` | Store desktop + phone, low-fi and hi-fi, degradation, login |
| Loader Hi-FI | `142:2` | Loader tablet + login |
| Style Guide | `510:15495` | Foundations sections + copies of every component set |

Earlier in the project the file also had "Low Fid" `0:1`, "test" `30:1976`, "High Fid" `12:2` (empty) and the friend's original NextDrop-branded "Dispatcher Hi-Fi" `70:2` (light theme, Inter, ~85 icon frames). **They were not in the page list on 30 Sep.** Check whether they were renamed, moved or deleted before assuming anything about them; the friend's original design language is the reference for the Dispatcher hi-fi.

## 4.1 Store Manager page (`197:5305`)

Sections: Low-fi Desktop `226:2`, Hi-fi components `226:5`, Low-fi Mobile `251:1332`, **Hi-fi Desktop `251:1335`**, **Hi-fi Mobile `251:1336`**, **Hi-fi Login `523:9160`**.

Desktop hi-fi frames (1440×900): S2 My deliveries `230:136`, S1 Place order `230:332`, S1 Products Fresh `232:326` (+ Style `489:17127`, Tech `489:17376`), S2 Order tracking `232:587`, S2 Order history `233:567`. Dialogs (open over the screens, 560 wide): Order placed `233:804`, Order timeline card `233:874`, Order detail `233:966`, Deferral notice `234:750`, Confirm receipt `234:803`, Report an issue `234:893`, Notifications popover `438:1358` (440×918, **not wired**). Desktop workflow card `252:1311`. Each has a dark "Rationale" card (Title / Job / Rationale) e.g. `489:17635`.

Phone hi-fi frames (390×844, "a day at OUT015" in time order): My deliveries 05:50 `248:960`, Confirm receipt 07:44 `235:944`, Report an issue 07:46 `235:1029`, Place order 13:12 `248:1062`, Add items `248:1168`, Review & submit `248:1301`, Order placed 13:14 `249:1133`, My deliveries deferral push 21:10 `235:832`, Deferral notice 21:05 `249:1206`, Order tracking 21:10 `249:1260`, Order timeline ORD10412 `250:1208`, Order history 21:10 `250:1298`, Order detail ORD10468 `250:1429`, Notifications panel `451:1367`, Notifications all-read `451:1577`. Bells added to the four top-level phone app bars. Mobile workflow card `252:1500`.

Degradation row (phone, y≈2431 in section `251:1336`): see §7.2.

Login row: Store desktop `523:9162`, Store phone `523:9199` (see §9).

## 4.2 Dispatcher page (`254:8156`)

Sections: Low-fi `266:15`, Hi-fi `266:19`, Example images `266:23`, Icons `266:25`, Components `267:2`, **Login `523:17406`**.
- Hi-fi (1600×1000): D0 Dashboard `254:8782`, D1 Order queue `254:9055`, D2 Plan board `254:9213`, D3 Defer & publish `271:866`, D4 Live runs `272:991`, D5 Capacity outlook `277:1215`, Fleet & capacity `254:9366`, Add-trip T015 modal `254:9528` (also `293:1593`, `293:1995`), constraint-breach modal `254:9641`, Dispatcher workflow card `317:1535`.
- Low-fi (1440×960): D0 `254:8157`, D1 `254:8266`, D2 `254:8384`, D3 `287:1278`, D4 `254:8576`, D5 `288:1306`, Fleet `254:8471`, add-trip modal `254:8678`, blocked `254:8729`.
- **Not wired** (no prototype flows), except the new login button.
- Sidebar hi-fi now shows the small "DISPATCHER" role label under the logo followed by a gap (changed 29 Sep to match the Store sidebar). The Style Guide page copy of the sidebar predates that fix.

## 4.3 Loader page (`142:2`)

Sections: Components `148:36`, **L1 `153:305`**, **L2 `159:1375`**, **L3 `165:3135`**, Workflow `238:3365`, **L0 Login `524:12438`**.
- L1: default `153:311`, plan-changed banner `153:545`, review sheet `153:785`, switch loader `158:938`, plan not published `158:1206`, reconnecting + overdue `158:1252`.
- L2: in progress `159:1381`, plan update highlighted `159:1836`, report short sheet `159:2325`, Sinhala `161:2436`, Tamil `161:2848`, damaged sheet `359:3405`, damaged sent `359:3602`, short sent `359:3789`, 5 of 7 `366:4726`, 6 of 7 `366:5229`, all 7 checked `366:5729`.
- L3: ready to hold `165:3141`, blocked `165:3306`, handed over `165:3485`.
- Rationale cards per section (e.g. `153:306`, `159:1376`, `165:3136`) and a workflow card `238:3366`.

## 4.4 Driver page (`297:6641`)

- Low-fi section `310:2` (greyscale Roboto 360×800): R1 `310:11`/`310:118`/`310:214` (Online, Offline, Plan changed), R2 `311:8`/`311:72`/`311:118`/`311:198`/`311:240` (Arriving, Outcome, Partial-refused, Proof, Saved), R3 `312:2`/`312:78`/`312:138` (Reconnecting, Conflict, All synced), workflow card `318:2`.
- Hi-fi section `326:14`: R1 Online `327:15`, Offline `329:159`, Plan changed `327:332`, Run updated `382:807`; R2 Arriving `329:297`, Outcome `329:422`, Partial `329:472`, Proof `329:563`, Saved `329:620`, Refused `382:627`, Proof photo `382:728`, Flag sheet `382:444`, Flag sent `382:533`; R3 Reconnecting `330:291`, Conflict `330:385`, All synced `330:464`; degradation row (§7.1); components `326:15`; **Login section `525:7858`** (R0 `525:7860`).

## 4.5 Style Guide page (`510:15495`)

Component copies: Dispatcher `510:16566`, Driver `510:17264`, Store `510:17401`, Loader `510:17866`. Foundations stacked above, in the x=−946 column: **Overview `512:7752`** (app cards + 5 principles), **Colour `512:7800`** (swatches bound live to variables, three palettes), **Typography `513:7752`** (every local text style in its own style, three groups), **Shape & spacing `513:7904`** (radius, spacing, touch targets, 34 icons), **Status & content `513:8160`** (status table with live chip instances from each app, plus three rule cards: when the network drops, writing, component rules). Guide chrome is Inter bound to "Store Manager · Light". The copies of component sets on this page predate later fixes (sidebar role label).

## 4.6 All Hi-FI page (`367:9318`)

63 static copies in 5 sections: Store Desktop 11, Store Phone 13, Dispatcher 9, Loader 16, Driver 14. Purpose: a judge can look at every main screen without wading through flows. **Stale:** predates the Store bells and notification panel, the degradation frames, the login screens, and the dispatcher sidebar role label.

---

## 12.1 Tooling

- Use the Figma MCP `use_figma` (Plugin API JS) with the `figma-use` skill loaded first. Scripts run atomically: a failed script is rolled back, so fix and rerun. Set the current page once per call (`figma.setCurrentPageAsync`), read other pages with `getNodeByIdAsync` / `loadAsync`.
- Screenshots via `get_screenshot` return a short-lived URL; download it and view it. Always look at screenshots after building.

## 12.2 Prototyping API

- `node.setReactionsAsync([{trigger:{type:"ON_CLICK"|"AFTER_TIMEOUT", timeout(seconds)}, actions:[…]}])`. Actions: `NODE` (`navigation` NAVIGATE / CHANGE_TO, `transition`, `resetScrollPosition`, `resetInteractiveComponents`), `BACK`, `URL`, `SET_VARIABLE`, `CONDITIONAL`. Transitions: PUSH / MOVE_IN with direction and easing, SMART_ANIMATE, DISSOLVE (durations in seconds).
- `page.flowStartingPoints` is writable but rejects duplicate nodeIds. **Cloning a flow-start frame copies its flow starting point** to the clone: clean them up after cloning.
- Overlay settings are **read-only**. Fake sheets/popups with full-frame states and SMART_ANIMATE: park the sheet off-canvas at x = frame width (or y = frame height) in the source frame under the **same layer name**, and give the destination frame the sheet in place. Overlays appended to auto-layout frames need `layoutPositioning = "ABSOLUTE"`.
- `setReactionsAsync` works on nested instance sublayers. Interactive component state (e.g. a toast that auto-hid) carries over between frames for same-named instances: use `resetInteractiveComponents: true`. `resetScrollPosition: false` keeps list scroll.
- Cloning a nested instance can wipe a sibling's override reactions: always re-verify by walking reactions from the flow starts (BFS) and reporting bad destinations, unreachable screens and dead ends. PhoneNav tab reactions live on the main component.
- For scrolling, set `overflowDirection = "VERTICAL"` on a clipped fixed-height frame and keep content at y ≥ 0.
- Text `characters` binds only to STRING variables. Keep FLOAT variables for maths and mirror them into STRING display variables with an EQUALS lookup CONDITIONAL chain. Visibility binds to BOOLEAN variables. Expression nodes use `{type:"EXPRESSION", resolvedType, value:{expressionFunction, expressionArguments}}`.

## 12.3 Auto-layout and component quirks hit in this file

- `resize()` after `layoutSizingVertical="FILL"` resets it to FIXED: resize first, then set FILL. `layoutMode` changes reset sizing to HUG. A new auto-layout frame's height can stay at 100 if you never set `counterAxisSizingMode = "AUTO"`. A FILL child measures its width at append time: create sibling shells first or fix widths.
- Text writes on a fresh clone's instance sublayers may not stick in the same call: rerun in a new call. Resizing a layer nested inside an instance does nothing: use variants.
- `findOne` inside instances skips hidden layers. `node.clone()` inside a Section may land at page top level: re-append explicitly. Swapping a button instance to a larger variant after cloning left it 1 px tall: create a fresh instance. Instance-swapping a button icon twice garbled it: clone a clean sibling.
- Bound paints fall back to black unless you pass the resolved base colour:
  ```js
  const pv = k => { const v = V[k]; const val = v.valuesByMode[modeId];
    return figma.variables.setBoundVariableForPaint({type:"SOLID", color:{r:val.r,g:val.g,b:val.b}}, "color", v); };
  ```
- Logo instances (`store-icon/logo`) keep their default dark stroke unless overridden white on dark panels.
- Section heights do not auto-fit: compute from children bounds after layout settles. A fixed-height title row with bottom alignment grows upward if a subtitle wraps.
- Hidden layers can hide bugs: the Dispatcher sidebar role label was invisible (`visible=false`), which is why the logo sat on the nav.
- `JSON_REST_V1` export is unavailable.

## 12.4 Conventions to keep

- Reuse components and variables; never hardcode colours where a variable exists.
- New per-app sections follow the pattern: label text + rationale card (cloned from an existing one, 480 wide) + frame(s) at x≈600, all inside a new Section that copies its neighbour's fill.
- After any prototype change, run the BFS reachability check.
- Ask before deleting pages or renaming things the friend created.

---

| I want… | Go to |
|---|---|
| The Blueprint's scope and rules | `Designation Blueprint.pdf` (13 pages) |
| Loader detailed spec | `loader-screens-spec.md` |
| The phone story of a day | Store page, section `251:1336`, flow "Phone · A day at OUT015" |
| Offline scenario end to end | Driver flow 4 (`481:664`) → flow 2 (`329:159`), Store degradation flow (`491:1402`), Dispatcher D4 (`272:991`) |
| Every main screen in one place (static) | Page "All Hi-FI" (`367:9318`) |
| Colours/type/status rules | Page "Style Guide" (`510:15495`), foundations sections |
| Login screens | See §9 |
