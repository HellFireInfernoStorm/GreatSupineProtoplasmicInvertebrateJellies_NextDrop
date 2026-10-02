---
status: draft
owner: Dinura
sources: design context §4, §12, §13; read-only review of the live Figma file on 2 Oct 2026 (ADR 0015)
---

# Figma file map and tooling notes

File key `BUan1C6oFA7OTc9o6cCQxv`. The latest version is the design source of truth (ADR 0015). Verified read-only on 2 Oct 2026. The Figma file is not being edited for now, so the defects in §4.10 stay in it.

List pages with `use_figma` (`figma.root.children`). The MCP `get_metadata` page listing without a nodeId shows only the first page.

| Page | ID | What is on it |
|---|---|---|
| User Personas | `510:19782` | One section per role (Role, Working context, Primary goal, Key tasks, Pain points / risks, Information they need), four "Main Features" lists, four generated persona images. No persona names. Supplementary to `product-and-roles.md` (ADR 0016) |
| All Hi-FI | `367:9318` | Static copies of every main screen (§4.6) |
| Dispatcher Hi-Fi | `254:8156` | Dispatcher low-fi, hi-fi, icons, components, login |
| Driver Hi-Fi | `297:6641` | Driver low-fi, hi-fi, degradation, components, login |
| Store Manager HI-Fi | `197:5305` | Store desktop and phone, low-fi and hi-fi, degradation, login |
| Loader Hi-FI | `142:2` | Loader tablet and login |
| Delivery Cycle Diagram | `510:19850` | Four-lane swimlane (§4.7) |
| Style Guide | `510:15495` | Foundations, Logos, copies of every component set (§4.5) |
| AI Tool Disclosure | `559:19610` | Designathon AI disclosure (§4.8) |

The old pages "Low Fid" `0:1`, "test" `30:1976`, "High Fid" `12:2` and the friend's NextDrop-branded "Dispatcher Hi-Fi" `70:2` are **deleted** (verified 2 Oct). The dispatcher visual language copied from `70:2` lives on `254:8156`.

## 4.1 Store Manager page (`197:5305`)

Sections: Low-fi Desktop `226:2`, Hi-fi components `226:5`, Low-fi Mobile `251:1332`, **Hi-fi Desktop `251:1335`**, **Hi-fi Mobile `251:1336`**, **Hi-fi Login `523:9160`**.

**Frame names are sequence numbers, not Blueprint IDs.** In Figma the desktop "S1 · My deliveries" is Blueprint S2 and "S2 · Place order" is Blueprint S1. The phone frames run S1 to S12 in the order of the day. Docs and code use the Blueprint IDs from `screens.md`.

Desktop hi-fi frames (1440×900):

| Figma name | ID |
|---|---|
| "S1 · My deliveries" | `230:136` |
| "S2 · Place order" | `230:332` |
| "S3 · Products Waypoint Fresh" | `232:326` |
| "… Style" | `489:17127` |
| "… Tech" | `489:17376` |
| "S4 · Order tracking" | `232:587` |
| "S5 · Order history" | `233:567` |

Dialogs (560 wide): Order placed `233:804`, Order timeline card `233:874`, Order detail `233:966`, Deferral notice `234:750`, Confirm receipt `234:803`, Report an issue `234:893`, Notifications popover `438:1358`. There are 12 rationale cards, and a desktop workflow card `252:1311`.

Phone hi-fi frames (390×844, "a day at OUT015"):

| Frame | ID |
|---|---|
| My deliveries 05:50 | `248:960` |
| Confirm receipt 07:44 | `235:944` |
| Report an issue 07:46 | `235:1029` |
| Place order (Fresh) | `248:1062` |
| Place order (Style) | `489:17704` |
| Place order (Tech) | `489:17813` |
| Add items (Fresh) | `248:1168` |
| Add items (Style) | `489:17922` |
| Add items (Tech) | `489:18054` |
| Review & submit | `248:1301` |
| Order placed | `249:1133` |
| My deliveries, deferral push 21:10 | `235:832` |
| Deferral notice | `249:1206` |
| Order tracking | `249:1260` |
| Order timeline | `250:1208` |
| Order history | `250:1298` |
| Order detail | `250:1429` |
| Notifications panel (unread) | `451:1367` |
| Notifications panel (all read) | `451:1577` |

There are 19 rationale cards, and a mobile workflow card `252:1500`.

The brand product and order pages show other outlets than OUT015: desktop Style `OUT042`, desktop Tech `OUT097` Kandy City, phone Style `OUT094`, phone Tech `OUT108`. The build shows one catalogue per account, from the outlet's brand (`screens.md` §6.1).

Degradation row (phone, section `251:1336`): see `degradation-scenario.md` §7.2. Login: Store desktop `523:9162`, Store phone `523:9199`.

## 4.2 Dispatcher page (`254:8156`)

Sections: Low-fi `266:15`, Hi-fi `266:19`, Example images `266:23`, Icons `266:25` (85 icons), Components `267:2`, Login `523:17406`.

Hi-fi frames (1600×1000):

| Frame | ID |
|---|---|
| D0 Dashboard | `254:8782` |
| D1 Order queue | `254:9055` |
| D2 Plan board | `254:9213` |
| D3 Defer & publish | `271:866` |
| **D4 Delivery Progress** | `272:991` |
| D5 Capacity outlook | `277:1215` |
| Fleet & capacity | `254:9366` |

Over the screens:

- **Add-trip modal:** valid state `293:1593`, **blocked state `293:1995`**. Both are named "Modal · Add trip T015". The blocked state has the "Blocked" chip, three failing checks and a disabled Create.
- **Toasts:** "Plan published successfully" `514:19044`, "Trip created successfully" `539:19554`, "ORD10412 added to next run" `528:1247`.
- **Notifications popover:** `502:17827`, with tabs All · Deliveries · Planning · Needs action.

Rationale cards:

| Card | ID |
|---|---|
| Dashboard | `514:19059` |
| Order Queue | `514:19064` |
| Plan Board | `514:19068` |
| Defer & Publish | `514:19072` |
| Add Trip valid | `514:19088` |
| Add Trip blocked | `514:19092` |
| Delivery Progress | `514:19098` |
| Capacity Outlook | `514:19102` |
| Fleet & Capacity | `514:19106` |
| Notifications | `514:19238` |
| Login | `523:17448` |

The workflow card is `317:1535`. The low-fi frames are 1440×960, with D4 still named "Live runs" there.

- **Wired:** every hi-fi frame is reachable from "Login · Dispatcher" (§8.1 of `prototype-flows.md`).
- **Sidebar labels:** Dashboard, Order queue, Plan board, Defer & publish, Delivery Progress, Capacity outlook, Fleet & capacity, Settings. The "DISPATCHER" role label is visible in every variant.

## 4.3 Loader page (`142:2`)

Sections: Components `148:36`, **L1 `153:305`**, **L2 `159:1375`**, **L3 `165:3135`**, Workflow `238:3365`, **L0 Login `524:12438`**.

| Section | States |
|---|---|
| L1 | default `153:311`, plan-changed banner `153:545`, review sheet `153:785`, switch loader `158:938`, plan not published `158:1206`, reconnecting + overdue `158:1252` |
| L2 | in progress `159:1381`, plan update highlighted `159:1836`, report short sheet `159:2325`, Sinhala `161:2436`, Tamil `161:2848`, damaged sheet `359:3405`, damaged sent `359:3602`, short sent `359:3789`, 5 of 7 `366:4726`, 6 of 7 `366:5229`, all 7 checked `366:5729` |
| L3 | ready to hold `165:3141`, blocked `165:3306`, handed over `165:3485` |

Rationale cards: L1 `153:306`, L2 `159:1376`, L3 `165:3136`, login `524:12505`. Workflow card: `238:3366`.

The loader story is Peliyagoda Dock 3, T001 · VEH001, handed to Ruwan S. The build uses the Kandy fixtures instead (ADR 0008).

## 4.4 Driver page (`297:6641`)

**Low-fi** section `310:2` (greyscale Roboto 360×800):

| Screen | Frames |
|---|---|
| R1 | `310:11` Online, `310:118` Offline, `310:214` Plan changed |
| R2 | `311:8` Arriving, `311:72` Outcome, `311:118` Partial-refused, `311:198` Proof, `311:240` Saved |
| R3 | `312:2` Reconnecting, `312:78` Conflict, `312:138` All synced |

The low-fi workflow card is `318:2`.

**Hi-fi** section `326:14`:

| Screen | Frames |
|---|---|
| R1 | Online `327:15`, Offline `329:159`, Plan changed `327:332`, Run updated `382:807` |
| R2 | Arriving `329:297`, Outcome `329:422`, Partial `329:472`, Proof `329:563`, Saved `329:620`, Refused `382:627`, Proof photo `382:728`, Flag sheet `382:444`, Flag sent `382:533` |
| R3 | Reconnecting `330:291`, Conflict `330:385`, All synced `330:464` |

The hi-fi section also holds:

- The degradation row (`degradation-scenario.md` §7.1).
- Rationale cards R1 `486:15885`, R2 `497:15897`, R3 `526:2094`.
- Components `326:15`.
- **Login section `525:7858`** (R0 `525:7860`, rationale `525:7930`).

The flag sheet reasons are: Store not open yet, Road closed or blocked, Can't reach the dock, **Vehicle problem**, Running late (ADR 0017).

The driver story uses placeholders (`OUT0xx`, `VEH0xx`) on a Kandy hub reefer run, and names loader "Kasun · Kandy dock".

## 4.5 Style Guide page (`510:15495`)

Foundations:

- **Overview `512:7752`** (header "Waypoint Delivery System", app cards, 5 principles).
- **Logos `652:46054`.**
- **Colour `512:7800`.**
- **Typography `513:7752`.**
- **Shape & spacing `513:7904`.**
- **Status & content `513:8160`** (status table plus rule cards).

Component copies: Driver `510:17264`, Store `510:17401`, Loader `510:17866`, Dispatcher `510:19084`. They are current: the dispatcher sidebar copy has the role label and "Delivery Progress".

**Logos.** The **NextDrop** wordmark has a parcel box replacing the "o", in white on three navy backgrounds: `logoBLUE`, `logoDARKBLUE`, `logoNOTSODARKBLUE`. It is raster only (rectangles with image fills), and **there is no vector source**. The raster is the source (ADR 0015): export it from Figma as PNG at 2× and 3× for the build, and do not redraw or trace it.

Principle 4 ("Never invent a real-looking ID") is superseded for the build by ADR 0008 (real IDs).

## 4.6 All Hi-FI page (`367:9318`)

Refreshed copies (IDs `589:*`). The page has five sections:

| Section | ID | Frames |
|---|---|---|
| Store Desktop | `397:2` | 6 |
| Store Phone | `397:1631` | 25 |
| Dispatcher | `397:2836` | 9 |
| Loader | `399:2586` | 21 |
| Driver | `399:7743` | 22 |

They include the logins, degradation frames, notifications and Style/Tech pages. Defects are in §4.10.

## 4.7 Delivery Cycle Diagram (`510:19850`)

The diagram has four lanes:

- Store manager (Desktop or Phone).
- Dispatcher (Large Screen).
- Loader (Dock Tablet).
- Driver (Personal Phone).

Steps and links:

1. Place Order before 4 PM → Close Orders, one queue → Plan + Defer with reason.
2. Plan + Defer branches to Deferral Alert (new date + why) and to Load Truck (flag shortfalls).
3. Load Truck leads to Monitor Runs (exceptions) and to Deliver (record POD).
4. Deliver leads to Monitor Runs and to Confirm receipt + issues.

## 4.8 AI Tool Disclosure (`559:19610`)

The disclosure has two paragraphs and a table:

| Tool | Used for |
|---|---|
| ChatGPT | Ideas, wording, rationales, persona checks, early logo ideas, drafting the disclosure |
| Claude | Initial low-fi and hi-fi designs, style guide, cross-user flow |
| Figma AI | Toasts and minor tweaks |
| Google Gemini | Persona images |

It is the Designathon part of `docs/ai-disclosure.md`.

## 4.9 Variables and styles

These match `design-system.md` §3.2 and §3.3: collections Loader 24, Store Manager 54, Store Manager · Light 26, Dispatcher · Light 13, Driver prototype 13. There are no paint styles and one effect style, "Store Manager/Card".

## 4.10 Known defects in the file (not fixed, ADR 0015)

Do not copy these into the build.

1. **Stale workflow cards.** Dispatcher `317:1535`, Store `252:1311` and `252:1500`, and Driver `318:2` say "Clickable prototype links are not wired yet". All four are wired.
2. **Store desktop notifications popover** `438:1358` has no links and cannot be closed. The build closes it like the other dialogs.
3. **Unreachable frames:** the Style/Tech brand frames on the Store page.
4. **Stray flow starting points:** Store "Flow 2" (on the TopBar component), Dispatcher "Flow 2" (on the topbar component) and "Flow 3" (on the valid modal), and All Hi-FI "Flow 1".
5. **Dispatcher sidebar component `267:458`:** the variants are named `Active=Live runs` and `Active=Deferrals & publish` while the labels say Delivery Progress and Defer & publish. 11 nav links on the component have no destination; instances override them.
6. **Mislabelled login rationale layers:** `524:12505` and `525:7930` are both named "Rationale · L1".
7. **All Hi-FI page:**
   - 11 frames sit outside their sections.
   - The Loader section has 6 stray TopBar/Body fragments (`589:36129` to `589:36252`).
   - No Store desktop login, no dispatcher toasts, and no Driver "R1" row title.
   - 120 links point to frames on other pages, so they do not play.

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
- Ask before deleting pages or renaming things the friend created. The file is not being edited for now (ADR 0015).

---

| I want… | Go to |
|---|---|
| Scope and rules | The Booklet, then this file and the Figma file (ADR 0015). The Blueprint PDF is not needed |
| Loader detailed rules | §4.3 and `design-system.md` §3.6–3.7 (the old `loader-screens-spec.md` is not needed) |
| Personas | `product-and-roles.md` (authoritative, ADR 0016); Figma page "User Personas" `510:19782` |
| The phone story of a day | Store page, section `251:1336`, flow "Phone · A day at OUT015" |
| Offline scenario end to end | Driver flow 4 (`481:664`) → flow 2 (`329:159`), Store degradation flow (`491:1402`), Dispatcher D4 (`272:991`) |
| Every main screen in one place (static) | Page "All Hi-FI" (`367:9318`) |
| Colours/type/status rules | Page "Style Guide" (`510:15495`), foundations sections |
| Logo | Style Guide, Logos `652:46054` |
| Cross-role cycle | Page "Delivery Cycle Diagram" (`510:19850`) |
| Designathon AI disclosure | Page "AI Tool Disclosure" (`559:19610`) |
| Login screens | `prototype-flows.md`, login table |
