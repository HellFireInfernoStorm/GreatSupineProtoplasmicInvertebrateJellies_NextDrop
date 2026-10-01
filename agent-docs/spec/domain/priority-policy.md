---
status: draft
owner: Dinura
sources: guide §4.7
---

# Priority and deferral policy

## 4.7 Priority and deferral policy ("the system proposes, the dispatcher decides")

Hard constraints are never overridable. Priorities are proposed and may be overridden with a reason. Default priority order (lexicographic):

1. Outlets deferred on the previous run (`deferred_yesterday`).
2. Chilled Fresh orders.
3. Fresh orders (must arrive before 08:00).
4. Most `days_since_last_served`.
5. Style/Tech orders that can move a day with least impact.

Tie-break: larger volume first, then order ID (deterministic). Every deferral MUST have a reason code and a cause kind (5.4). Deferring an outlet that was deferred last run triggers a repeat-skip warning requiring an explicit note.
