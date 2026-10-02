---
status: draft
owner: Dinura
sources: guide §5.6
---

# Rules config

## 5.6 Config

All tunables live in one typed `RulesConfig` (defaults in section 21): budgets, window start times, reload buffer, fuel-return flag, ETA band, priority weights order, local-search iteration cap.

Additional keys: `validationEtaIncludesReturn` (default `false`, ADR 0003); `priorityOrder` (ordered array of the class keys in [priority-policy.md](../domain/priority-policy.md), ADR 0009); `agingDeferralCount` (default 2).
