---
status: draft
owner: Dinura
sources: design context §1; Figma page "User Personas" (ADR 0016)
---

# Product, roles and design trade-off

**One plan, four views, one record per order.** Waypoint's real problem is not routing. Capacity is short on most days, so the dispatcher makes hard trade-offs and nobody downstream can see them. Information is retyped at each handoff (phone → spreadsheet → printed sheet → verbal instruction → handwritten note) and context is lost at each step.

An **order** is a single object with a **timeline**. Every role reads it and adds events to it:

`Ordered → Planned / Deferred → Loaded / Short → Out for delivery → Delivered → Received / Disputed`

The dispatcher's published plan is the source every other role reads. Every field event writes back to the record.

## The four roles (personas from the Blueprint)

These personas are authoritative for the build (ADR 0016). The Figma page "User Personas" (`510:19782`) adds working context. It is used where it does not contradict this table.

- **Dispatcher:** dual monitors and 6 years running the network. Time pressure between the 16:00 cutoff and night loading, with constant phone calls. The plan lives in their head and a spreadsheet.
- **Loader:** several trucks at once. Printed lists go stale. On a shared device it is unclear who flagged what.
- **Driver:** relies today on a paper run sheet and phone calls.
- **Store manager:** orders by phone or message today, with no confirmation.

The Figma page names no one, and where it gives personal details that differ (for example the dispatcher's age and pronouns), this table wins. Docs refer to personas by name or role, without pronouns.

| Role | Persona | Context | Device | Design rules the persona forces |
|---|---|---|---|---|
| Store manager | **Dilini**, Waypoint Fresh outlet (design: Wellawatte, `OUT015`; build: `OUT004`, Colombo, ADR 0027) | Orders dry goods daily and chilled on some days, so can have two orders for one delivery day. Store opens 08:00. | Phone or back-office desktop | Mobile-friendly, visible 4 PM cutoff countdown, deferral arrives as a push notice (not discovered), receipt confirmation pre-filled from the driver's record |
| Dispatcher | **Nimal**, senior dispatcher, Peliyagoda DC | Plans every night after the 16:00 cutoff on a large office screen | Desktop | Dense keyboard-friendly layout, constraint breaches blocked with a reason (never silently allowed), every deferral needs a reason code |
| Loader | **Kasun**, night shift, Peliyagoda dock | Loads Fresh trucks in the early hours (trucks leave ~03:30). Shared tablet at the dock. Noisy, dim, gloves. | Tablet (landscape) | 48 px+ tap targets (we went to 64/80), high contrast, minimal typing, Sinhala/Tamil/English, live list that flags plan changes loudly |
| Driver | **Sampath**, reefer truck driver, Kandy hub | Own mid-range Android, prepaid data, signal drops for long stretches. Used only when safely stopped. | Phone (360×800) | One stop per screen, big primary action, everything saves locally first, sync state always visible, light on data (compressed photos) |

## Ranked problems from the brief (what we design hardest for)

1. Deferrals lack a clear record → deferral review with reason codes, repeat-skip guard, store notice
2. Delivery progress hard to track → live run monitor built on delivery events, not GPS
3. Field connectivity unreliable → offline-first driver app (our degradation scenario)
4. Communication doesn't support feedback → loader shortfall flag, driver proof of delivery
5. Planning fragmented → store managers order in-app with a cutoff countdown
6. Service time / lateness not predicted → late-risk badge on plan board (models belong to the Datathon)
7. Demand hard to anticipate → one capacity-outlook screen (D5)

## What we deliberately left out (restraint scores 15%)

Live GPS map, turn-by-turn navigation (deep-link to Google Maps instead), in-app chat (structured flags instead: short, damaged, refused), inventory/invoicing/fuel purchasing, separate apps per role (it is one responsive web app with role-based views), full route-optimisation UI (system proposes, dispatcher adjusts by exception), driver rosters.

## Domain constraints that must show up in the UI

Max 2 trips per vehicle per day, Monday–Saturday only, weekly fuel quota per vehicle, chilled goods only on reefers (16 of 60 vehicles), `van_only` outlets served by vans only (8 vans). Fresh trips run 03:30–08:00 with a 270 min budget per vehicle. Style and Tech trips run in the trading day with a 480 min budget, and mall outlets only inside the mall window.

## Core trade-off: the system proposes, the dispatcher decides

- **Hard constraints** are enforced and can never be overridden: weight, volume, reefer for chilled, vans for `van_only`, home depot, one brand and district per trip, max 2 trips, 270/480 min budgets, weekly fuel quota.
- **Priorities** are proposed and can be overridden with a reason. Default order (ADR 0009, `spec/domain/priority-policy.md`): (1) chilled Fresh, (2) other Fresh, (3) Style/Tech from outlets deferred on the previous run, (4) most days since last served, (5) remaining Style/Tech, smallest slip deferred first. The Designathon draft put "deferred yesterday" first; ADR 0009 replaced it.
- Cost: extra clicks, because every deferral needs a reason code. That is intended: the reason codes are the deferral record Waypoint does not have today.

## Shared building blocks (keep the four views consistent)

- **Order timeline card**: same component in every role; each event shows who, when it happened, and when it synced.
- **One status vocabulary** with the same chip colours everywhere (see §3.4).
- **Constraint badges**: Chilled, Van only, Mall window, Rear dock / Street / Mall bay, Skipped yesterday.

---
