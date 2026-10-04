---
status: draft
owner: Dinura
sources: design context §7; Figma review of 2 Oct 2026 (ADR 0015)
---

# Degradation scenario: dead zone on the hill run

**Scenario.** A reefer truck from Kandy loses signal on its Fresh run in the hill country with stops still to make before 08:00. While it is offline the dispatcher changes one remaining stop. **Why it matters.** The Kandy corridor and hill country are daily blind spots. Without offline support proof of delivery returns to paper and memory, the dispatcher is blind where delays are likeliest, and the store cannot tell "late" from "lost".

**What each role sees**
| Role | Screen | State |
|---|---|---|
| Driver | R1, R2 | Persistent amber bar "Offline — 3 deliveries saved on this phone", "saved on phone" ticks, photos compressed and queued |
| Driver | R3 | On reconnect: progress count; conflicts shown side by side |
| Dispatcher | D4 | Grey "last known" card: "Last heard … · stop 3 of N · low-coverage district"; escalate only if behind schedule |
| Store manager | S2/S3 | "Delivered 06:12 · confirmed 07:40 after sync": both timestamps, never merged |

**Recovery rules (the Hackathon team builds these as-is)**
1. Delivery facts recorded by the driver win and keep the phone's capture time.
2. Dispatcher changes win for stops not yet visited (reach the driver as soon as sync completes).
3. A true clash is never auto-resolved. Example: dispatcher cancelled a stop the driver already delivered offline → dispatcher's exceptions inbox with the driver's proof-of-delivery photo.
4. Nothing disappears silently. The pending count only drops when the server confirms each record.
5. Text records sync before photos.

Decided (ADR 0013): no SMS backup; urgent plan changes use in-app notices only. Alternative scenario considered: "Shortfall at the dock".

## 7.1 Driver degradation (Figma)

Existing story flow **"2 · Dead zone: offline → sync → clash → new plan"** (start `329:159`): R1 Offline → Reconnecting `330:291` (auto-advances after **4 s**) → Conflict `330:385` → All synced `330:464` → Plan changed `327:332` (sheet parked inside All synced) → Run updated `382:807`.

New flow **"4 · Degradation — dead zone: deliver offline → sync → clash"** (start `481:664`, new row "Degradation" in section `326:14`), built 29 Sep:
1. `481:664` R1 Offline 06:30: "1 delivery saved", 4/7 done, stop 5 Talawakele next (button "Go to stop 5")
2. `481:792` Arriving offline 06:38: "Working offline" note, plan saved at 05:50, last sync 05:44
3. `481:956` Outcome offline 06:39: "How did it go?" → Delivered in full (12 crates)
4. `481:1024` Proof offline 06:40: receiver name, signature or photo
5. `481:1099` Saved on this phone: "Waiting for signal, text and signature queued, photo compressed to 190 KB" → **"Continue the run"** → joins `329:159` (07:02, 3 saved) and the existing sync/clash/plan-change story.
Verified: 11 screens reachable from `481:664`, no broken links, only Run updated is a dead end (natural end). Note: text on these frames is not bound to the stop-3 counter variables, so only the original flow-1 steppers update live.

## 7.2 Store Manager degradation (Figma)

Flow **"Phone · Degradation — driver out of signal (06:20 → 07:44)"** (start `491:1402`, row under the mobile workflow card):
1. `491:1402` My deliveries 06:20: hero shows a neutral "No signal" chip, "Last heard 05:48 · stop 3 of 7 · low-coverage area", Refresh button, greyed "Confirm after the driver syncs", card "Not late — just out of signal" with link "Late or lost? How to read this →"
2. `491:1651` "Late or lost?" bottom sheet (SMART_ANIMATE over a scrim): grey = no signal; amber = running late; "Nothing is lost". "Got it" or scrim closes.
3. `491:1796` Order timeline "waiting for sync" step (chip "No signal", "last heard 05:48")
4. `491:1520` My deliveries 07:41 after Refresh: push "Delivered 06:12 · ORD10412 (chilled) — Confirmed 07:40 after the driver's phone synced", hero "Delivered 06:12 · Confirmed 07:40 after sync · Ruwan S. · VEH001", Confirm receipt button
5. `491:1891` Timeline synced with note "Two times, never merged"
→ Confirm receipt `235:944` (existing). Verified: 17 screens reachable including the rest of the phone app; no dead ends.
Caveat: someone else added a green **"Confirm Delivery"** button (hero, second Actions frame) and a **"View order"** bar (timeline) to the original Store frames on 29 Sep. Clones inherit them; we adapted the labels/links.

## 7.3 Dispatcher side of the story (partly done)

**In Figma.** D4 has the grey card "T002 · VEH004 · Gampaha · Fresh · Last sync 07:22 · stop 3 of 5 · low-coverage area near Minuwangoda". That is a Peliyagoda trip, not the Kandy truck. Two things are not drawn: a "Sync clash" item in the D4 inbox (rule 3) and the escalated (behind schedule) state. The Driver workflow card has the dispatcher cancel stop 5 at 06:31 from D4, so the design story needs the clash item.

**Build** (ADR 0008 amendment):

- The grey card shows the Kandy fixture trip that the driver and store screens use.
- The **Sync clash** inbox item reuses the dispute evidence panel. It shows the driver's proof of delivery and capture time beside the plan change that cancelled or moved the stop. Actions: Accept fact / Reject fact (`CONFLICT_RESOLVED`). Conflict kinds are labelled from `spec/sync/recovery-and-conflicts.md`.
- **Escalated** (`ESCALATED`: no signal and behind schedule) uses the existing status tones. The Style Guide rule is "Late is not lost: only mark a run amber when it is behind plan; escalate only then".

**As built (#61).** The grey card is dashed, with a neutral "No signal" pill and "Last heard 06:31 · N min ago · stop N of M · district"; the escalated card keeps the grey card with a danger pill, a red border and a call-the-driver note. The Sync clash item uses the danger tone of the other inbox items and is listed first. Its evidence panel puts a "Plan change" panel (conflict kind and the time the clash opened on sync) beside the driver's proof-of-delivery photos. The clash names the order from the stops the dispatcher's session has seen on today's runs, because a cancelled stop leaves the runs. A dispute's store column shows the store's report: stores cannot upload photos in this build (ADR 0035), so every photo the exception carries is the driver's proof.

---
