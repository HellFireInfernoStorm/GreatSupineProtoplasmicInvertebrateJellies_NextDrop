---
status: draft
owner: Dinura
sources: design context §3
---

# Design system

## 3.1 Themes per app

| App | Theme | Font | Frame sizes | Primary look |
|---|---|---|---|---|
| Store Manager | Light | Inter | Desktop 1440×900, phone 390×844 | Navy panel `#131A26`, dark navy primary button, green `ok` accents |
| Dispatcher | Light (Store tokens + own additions) | Inter | 1600×1000 hi-fi, 1440×960 low-fi | Navy sidebar `#0E1724` with `#142B33` active, green brand `#087A52`, bell topbar |
| Loader | Dark | Noto Sans (+ Yaldevi for Sinhala because Noto Sans Sinhala is not available in Figma; Noto Sans Tamil for Tamil) | 1280×800 landscape | bg `#0F1216`, light `#F2F4F7` primary button |
| Driver | Dark (bound to the **Loader** variable collection) | Noto Sans | 360×800 | Same dark tokens as Loader, phone-sized |
| Low-fi (Dispatcher, Driver, Store) | Greyscale wireframes | Roboto (driver low-fi), grey `#F6F6F6` frames (dispatcher low-fi) | same sizes | Placeholder boxes, ≤2-line notes |

The Dispatcher hi-fi visual language was copied from the friend's original "Dispatcher Hi-Fi" work (soft 42 px icon tiles on KPI cards, dotless pills, underline tabs, 8 px per-metric bars, Bold 32 page titles).

## 3.2 Figma variable collections (local)

- **Loader** (dark, 24 variables): `color/bg #0F1216`, `surface #1A1F26`, `surface-2 #252C36`, `border #3A4350`, `text #F2F4F7`, `text-muted #A7B0BC`, `text-disabled #6B7480`, `on-accent #0F1216`, `scrim #000 @60%`; status triplets `ok #2FBF71 / ok-fg #74E0A6 / ok-bg #1E3F35`, `warn #F5A524 / #FFC766 / #463A26`, `danger #F04438 / #FFA8A0 / #45262A`, `chilled #3BA3FF / #9BD1FF / #213951`, `info #8B9DFF / #C2CBFF / #313851`. Contrast target 7:1 for primary text.
- **Store Manager · Light** (26 variables, the one the hi-fi screens use): `bg #FFF`, `surface #FFF`, `surface-2 #F6F9FA`, `surface-3 #EEF1F4`, `border #DBE0E5`, `text #131A26`, `text-muted #6B7585`, `text-faint #9AA3B0`, `panel #131A26`, `panel-2 #1F2C3D`, `panel-line #2E3D4A`, `on-panel #FFF`, `on-panel-muted #B2C2CF`, `ok #087A52 / ok-bg #E0F7ED`, `warn #B45F06 / #FFF5DE`, `danger #C4262C / #FFE8EB`, `info #1F6BD6 / #E5F0FF`, `purple #6B38CD / #EEE6FC`, `neutral #465264 / #EEF1F4`, `scrim #131A26 @50%`.
- **Store Manager** (older, 54 variables with primitives, space `4/8/12/16/20/24/32` and radius `8/12/16`): kept but the hi-fi screens use the "· Light" collection.
- **Dispatcher · Light** (13): `brand #087A52`, `brand-bg #E0F7ED`, `accent #F2941F`, `accent-bg #FFF5DE`, `nav-bg #0E1724`, `nav-active #142B33`, `nav-line #2E3D4A`, `nav-muted #B2C2CF`, `track #EBEDF2`, `link #2778F8`, `avatar #6B7585`, `row-soft #F9FAFB`, `tab-muted #878E9C`.
- **Driver prototype** (13, mode "Demo"): FLOAT/STRING/BOOLEAN variables for the stop-3 quantity steppers (`stop3/chilled accepted`, `…returned`, `ambient …`, totals, `has returns`, plus `stop3/display/*` string mirrors).

## 3.3 Text styles (all local)

- `Loader/*` Noto Sans: Display 56, Key 40, Title 32, Row title 24, Body 20, Body strong 20, Button 22, Label 18, Caption 16.
- `Store/*` Inter: Display 36, H1 30, H2 20, Title 16, Body 14, Body strong 14, Small 12, Label 12, Chip 11, Eyebrow 11. (`Store Manager/*` is an older duplicate set.)
- `Dispatcher/*` Inter: Page title 32, KPI 27, Headline 20, Card title 17, Body 14, Body strong 14, Label 12, Small 11, Caption 10, Pill 11, Eyebrow 11, Nav 13, Nav active 13, Button 13, Button sm 12.
- `Driver/*` Noto Sans: Display 32, Title 20, Headline 18, Body 15, Body strong 15, Label 13, Caption 12, Chip 12, Eyebrow 11, Button 17, Button sm 15, Number 28.

## 3.4 Status language (same state, same colour in every app)

| State | Use for | Store chip tone | Dispatcher pill | Loader/Driver chip |
|---|---|---|---|---|
| On track / done | Delivered, received, synced, on time | ok | green | ok |
| Needs attention | Short at dock, late risk, low signal, partial | warn | orange | warn |
| Act now | Failed stop, disputed, capacity breach, damaged | danger | red | danger |
| Planned / informational | Planned, sent, seen, to confirm | info | blue | info |
| Chilled | Reefer and cold-chain | (none) | (none) | chilled |
| Deferred | Moved by the planner | purple | purple | (none) |
| Neutral / no data | No signal, unknown | neutral | grey | neutral |

## 3.5 Components per app (component sets)

- **Store** (page "Store Manager HI-Fi Claude", section `226:5`): Chip `228:39` (tone ok/warn/danger/info/purple/neutral, prop `Label#228:0`), Button `228:100` (Style primary/secondary/ghost/on-panel/on-panel-outline × Size sm/md/lg; props `Label#228:7`, `Icon#228:23`, `Show icon#228:39`; heights 36/44/52), Stepper `228:117`, Sidebar `228:376` (6 variants, 240×900), TopBar `228:377` (has an unread dot), PhoneNav `228:478` (Active = My deliveries | Place order | Receipt | History; 390×72), TimelineEvent `228:495` (State done|latest; props `Status#228:58`, `Detail#228:61`, `Who#228:64`), Store icons frame `228:2` (`store-icon/*`: search, calendar, chevron-down, arrow-left, logo).
- **Dispatcher** (section `267:2`): sidebar hi-fi `267:458` (7 variants by active item), sidebar low-fi `267:648`, Dispatcher button `301:1553` (Style primary/secondary/disabled × md/sm; props `Label#301:0`, `Chevron#301:7`), Dispatcher pill `301:1566` (Tone green/blue/orange/red/purple/grey; `Label#301:14`), topbar `301:1567` (Date, Unread). 85 `dispatcher-icon/*` components in section `266:25` (24 px, 1.8 stroke).
- **Loader** (section `148:36`): Chip `149:32` (tone × size md/sm), Button `149:93` (Style primary/ok/secondary/warn/danger/disabled × md 64px / lg 80px; `Label#149:14`, `Show icon#149:40`), SyncState (sending/sent/seen), LoaderTile, TopBar, ReasonChip, TripCard, OrderRow (9 variants), CapacityBar (Fill=0..100), HoldButton (96px), Toast set `358:3405` (Shown `149:178`, Hidden `358:3399`), and `icon/*` set (46 icons: check, warning, critical, thermometer, reefer, van, window, dock, history, loading, pending, photo, vehicle, driver, profile, stop, items, weight, volume, open, flag, add, delete, cancel, info, lock, refresh, trip, route, outlet, issues, notifications, deferred, chevron-right, plus, minus, arrow-down, check-double, undo, snowflake, globe, camera, switch, send, clock, sequence).
- **Driver** (section `326:15`): Driver button `326:112` (Style primary/ok/secondary/warn/danger/disabled × lg 56/md 48; `Label#326:0`, Leading icon, Chevron, Icon), Driver chip `326:142`, Driver sync pill `326:154` (State Synced/Syncing/Offline; `Label#326:73`), Driver status bar `326:173` (Signal On/Off, Time), Driver reason chip `381:415`, Driver signature pad `381:465`.

## 3.6 Shape, spacing, touch (from the Style Guide page)

Radius: 8 small buttons/inputs, 12 rows/tiles, 16 cards, 20–24 phone cards/sheets, 999 chips/pills. Spacing scale 4-pt (mostly 8/12/16; gutters 16 phone, 32–40 desktop). Touch: Loader buttons 64 (md) / 80 (lg), hold-to-confirm 96, no text below 16; Driver 56 (lg) / 48 (md) pinned to the bottom; Store phone buttons 36/44/52 and 72 px tab bar; Store/Dispatcher desktop buttons 32–44, sidebar 240 wide.

## 3.7 Copy and behaviour rules (also on the Style Guide page)

- Times are 24-hour `HH:MM`; day only when not today ("Thu 1 Oct"). Show **two timestamps, never merged**: "Delivered 06:12 · confirmed 07:40 after sync".
- Counts say what they count ("16 of 20 crates", "stop 3 of 7").
- IDs: `OUT0xx` outlets, `VEH0xx` vehicles, `T0xx` trips, `ORD1xxxx` orders. Keep placeholders obviously placeholders.
- One filled primary button per screen. Bottom sheets sit over a scrim; scrim or "Got it" closes. Loader toast hides after 5 s and always offers Undo. Irreversible loader hand-over uses a hold-to-confirm button. Amber before red; offline is grey/amber, never red.
- No gesture is the only way to do something (loader spec).

---
