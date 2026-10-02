---
status: draft
owner: Dinura
sources: guide §4.7, ADR 0009
---

# Priority and deferral policy

## 4.7 Priority and deferral policy ("the system proposes, the dispatcher decides")

Hard constraints are never overridable. Priorities are proposed and may be overridden with a reason. The order is lexicographic and kept in `RulesConfig.priorityOrder`:

1. Chilled Fresh orders.
2. Other Fresh orders (must arrive before 08:00).
3. Style/Tech orders from outlets deferred on the previous run (`deferred_yesterday`).
4. Style/Tech orders from outlets not served for at least `staleServiceDays` (default 7), by most `days_since_last_served` (ADR 0022).
5. Remaining Style/Tech orders, ranked by the **slip** of deferring them.

Inside classes 1 and 2: outlets deferred on the previous run first, then most `days_since_last_served`.

**Aging guard**: an order with `deferredCount >= agingDeferralCount` (default 2) sorts first within its class. It never rises above chilled Fresh.

**Least impact (class 5)**: `slip = nextServiceableDate - requestedDate` in operating days. A larger slip means the order is more costly to defer, so it ranks higher. The smallest-slip orders are the first to move a day.

Tie-break: larger volume first, then order ID (deterministic). Every deferral MUST have a reason code and a cause kind (5.4). Deferring an outlet that was deferred last run triggers a repeat-skip warning requiring an explicit note.
