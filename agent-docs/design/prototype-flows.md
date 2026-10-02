---
status: draft
owner: Dinura
sources: design context §8, §9; Figma review of 2 Oct 2026 (ADR 0015)
---

# Prototype flows and login screens

## 8.1 Flow starting points (Figma "Flows")

- **Store page**: Flow 1 (`230:136`), Flow 2 (`228:377`), Flow 3 (`235:832`) were made by the user: **leave them**. Ours: "Phone · A day at OUT015 (05:50 → 21:10)" (`248:960`), "Phone · Notifications panel (21:10)" (`250:1298`), "Phone · Degradation — driver out of signal (06:20 → 07:44)" (`491:1402`), "Login · Store desktop" (`523:9162`), "Login · Store phone" (`523:9199`).
- **Loader**: "1 · Plan change → hand-over (main)", "2 · Start of shift", "3 · Connection drops", "0 · Login" (`524:12439`).
- **Driver**: "1 · Stop 3 delivery (full, partial or refused)" (`327:15`), "2 · Dead zone…" (`329:159`), "3 · Flag a problem at the store" (`329:297`), "4 · Degradation…" (`481:664`), "0 · Login" (`525:7860`).
- **Dispatcher**: "Login · Dispatcher" (`523:17408`) and "Flow 1" (`254:8782`). Two stray starts: "Flow 2" on the topbar component, "Flow 3" on the valid add-trip modal.
  - **Wired.** Every hi-fi screen, both modal states, the popover and the three toasts are reachable from login.
  - Sidebar items link to their screens, and the bell opens the popover; popover items link to D2, D3, D4 and Fleet.
  - D2 "+ Add trip" opens the modal, and valid ↔ blocked switch inside it. Create leads to the "Trip created" toast.
  - D3 Publish leads to the "Plan published" toast. On D4, "Add to Wed run" leads to "ORD10412 added to next run".
- **Store desktop**: wired. Login · Store desktop reaches the 5 main screens, 6 dialogs and the notifications popover; the popover has no close (`figma-reference.md` §4.10). The Style/Tech product frames are not linked.

## 8.2 Loader demo sequence (for the video)

Every Loader frame is reachable; the main flow reaches 19. On L2: mark **2 damaged** (opens damaged sheet → sent), **4 short** (short sheet → short sent, toast), and **3, 5, 6, 7 loaded**. The state counter progresses 5 of 7 → 6 of 7 → all 7 checked. **Review & mark ready** goes to L3 "Hold to mark ready" only when all are checked; otherwise it goes to the **blocked** screen. Toast auto-hides after 5 s and Undo goes BACK. The blocked screen returns with Back.

## 8.3 Driver flow wiring

Every hi-fi frame is reachable; from login, 20 nodes including sheet states. Steppers on the outcome/partial screens use the `Driver prototype` variables. Reconnecting auto-advances after 4 s. Google Maps buttons are URL actions.

## 8.4 Store phone wiring

58+ interactions; the phone flows reach 14 to 19 frames (the degradation flow reaches 19); the Style/Tech place-order and add-items frames are not linked; tabs are time-of-day aware (the tab bar goes to the version of a screen that fits the story time), back rows use BACK, no dead ends.

## 8.5 Login wiring

Each Sign in button dissolves to the app's first screen: Store desktop → `230:136`, Store phone → `248:960`, Dispatcher → D0 `254:8782`, Loader → L1 `153:311`, Driver → R1 `327:15`.

---

Simple, on-theme, one per app plus a Store phone version, each with a rationale card (Title / Job / body / States) placed beside the frame.
| App | Frame | Design |
|---|---|---|
| Store desktop | `523:9162` 1440×900 | Navy brand panel (560) with the promise "Order for tomorrow, and know exactly when it arrives." + white form: email or outlet ID, password (Show), keep me signed in, Forgot password, Sign in. No sign-up: dispatcher creates store logins. |
| Store phone | `523:9199` 390×844 | Dark header (logo, "Sign in", "Store manager · Tue 29 Sep") with a white rounded sheet holding the same form. |
| Dispatcher | `523:17408` 1600×1000 | Navy panel 640 + white form: work email, password, **Depot** select (Peliyagoda DC), green primary. |
| Loader | `524:12439` 1280×800 | Left: logo, EN / සිංහල / தமிழ் language chips, Loader ID `LDR0xx`, PIN dots (2 of 4 filled), Sign in (80 px). Right: 3×4 keypad, keys 140×96. "Works offline after your first sign-in on this tablet." |
| Driver | `525:7860` 360×800 | Status bar, logo, "Sign in", Driver ID `DRV0xx`, PIN dots, keypad, Sign in, offline note. |
Only the default state is drawn; the States line in each rationale describes error and lockout handling in words. The logins are on the All Hi-FI page, except Store desktop. The login panels say "Waypoint"; the build says NextDrop (ADR 0012). The Sinhala chip uses the same font as the existing Sinhala screen and needs the same native-speaker check.

---
