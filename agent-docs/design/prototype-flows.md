---
status: draft
owner: Dinura
sources: design context §8, §9
---

# Prototype flows and login screens

## 8.1 Flow starting points (Figma "Flows")

- **Store page**: Flow 1 (`230:136`), Flow 2 (`228:377`), Flow 3 (`235:832`) were made by the user: **leave them**. Ours: "Phone · A day at OUT015 (05:50 → 21:10)" (`248:960`), "Phone · Notifications panel (21:10)" (`250:1298`), "Phone · Degradation — driver out of signal (06:20 → 07:44)" (`491:1402`), "Login · Store desktop" (`523:9162`), "Login · Store phone" (`523:9199`).
- **Loader**: "1 · Plan change → hand-over (main)", "2 · Start of shift", "3 · Connection drops", "0 · Login" (`524:12439`).
- **Driver**: "1 · Stop 3 delivery (full, partial or refused)" (`327:15`), "2 · Dead zone…" (`329:159`), "3 · Flag a problem at the store" (`329:297`), "4 · Degradation…" (`481:664`), "0 · Login" (`525:7860`).
- **Dispatcher**: "Login · Dispatcher" (`523:17408`) only. Dispatcher screens are **not wired**. Store **desktop** screens are **not wired** (only login → My deliveries).

## 8.2 Loader demo sequence (for the video)

On L2: mark **2 damaged** (opens damaged sheet → sent), **4 short** (short sheet → short sent, toast), and **3, 5, 6, 7 loaded**. The state counter progresses 5 of 7 → 6 of 7 → all 7 checked. **Review & mark ready** goes to L3 "Hold to mark ready" only when all are checked; otherwise it goes to the **blocked** screen. Toast auto-hides after 5 s and Undo goes BACK. Verified end to end: 20 screens reachable.

## 8.3 Driver flow wiring

16 screens reachable. Steppers on the outcome/partial screens use the `Driver prototype` variables. Reconnecting auto-advances after 4 s. Google Maps buttons are URL actions.

## 8.4 Store phone wiring

58 interactions, 15 frames reachable, tabs are time-of-day aware (the tab bar goes to the version of a screen that fits the story time), back rows use BACK, no dead ends.

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
Only the default state is drawn; the States line in each rationale describes error and lockout handling in words. Login is **not** on the All Hi-FI or Style Guide pages yet. The Sinhala chip uses the same font as the existing Sinhala screen and needs the same native-speaker check.

---
