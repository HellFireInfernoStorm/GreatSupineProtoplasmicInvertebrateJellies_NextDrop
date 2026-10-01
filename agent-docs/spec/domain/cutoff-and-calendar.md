---
status: draft
owner: Dinura
sources: guide §4.6
---

# Cutoff and calendar

## 4.6 Cutoff and calendar

- Cutoff for delivery date D = **16:00 Asia/Colombo on calendar day D-1**. After that, the order targets the next operating date after D.
- A non-operating target date (Sunday, holiday) rolls to the next operating date.
- Planning day states: `OPEN -> CLOSED (at cutoff) -> PLANNING (draft exists) -> PUBLISHED (v1..n) -> IN_PROGRESS -> COMPLETE`.
- Deferred orders automatically re-enter the queue for the next operating day, carrying deferral counters.
