---
status: draft
owner: Dinura
sources: guide §4.6
---

# Cutoff and calendar

## 4.6 Cutoff and calendar

- Cutoff for delivery date D = **16:00 Asia/Colombo on calendar day D-1**. After that, the order targets the next operating date after D. Asia/Colombo is a fixed UTC+05:30, so the rules core computes the cutoff instant without a time-zone library (ADR 0018).
- A non-operating target date (Sunday, holiday) rolls to the next operating date. `is_operating` decides, not `is_holiday`: some holidays operate.
- Dates outside `calendar.csv` (it ends on 2026-06-28) are operating Monday to Saturday, with no holiday, festival, payday or monsoon (ADR 0018).
- Brand ordering guidance (ADR 0010, ADR 0018) is a notice only: `ordering.nonOperatingDay` for any brand on a non-operating date; otherwise Fresh `ordering.fresh.separateChilled`, Style `ordering.style.peakAhead` while `festival_ramp > 0` and `ordering.style.weeklyDay` otherwise, and Tech `ordering.tech.singleItems`.
- Planning day states: `OPEN -> CLOSED (at cutoff) -> PLANNING (draft exists) -> PUBLISHED (v1..n) -> IN_PROGRESS -> COMPLETE`.
- Deferred orders automatically re-enter the queue for the next operating day, carrying deferral counters.
