---
status: draft
owner: Dinura
sources: guide §21
---

# Assumptions registry

| Key | Default | Notes |
| --- | --- | --- |
| `CUTOFF_TIME` | 16:00 on D-1 (Asia/Colombo) | Server-enforced; demo clock aware |
| `FUEL_INCLUDE_RETURN` | `true` | Booklet says only "route distance consumes allowance" |
| `QUOTA_WEEK_RESET` | ISO week, Monday | Matches `calendar.csv` |
| `FRESH_FIRST_DEPARTURE` | 03:30 | Fresh window start |
| `RETURN_TIME` | equal to outbound time | Used for trip-2 ETA only |
| `RELOAD_BUFFER_MIN` | 15 | Between trip 1 return and trip 2 departure |
| `TRADING_DAY_START` | 08:00 | Earliest Style/Tech departure |
| `ETA_WINDOW_MIN` | 30 | Store-facing ETA band |
| `NO_SIGNAL_AFTER_MIN` / `BEHIND_GRACE_MIN` | 10 / 15 | D4 state labels |
| Session lifetime | web 12 h, field 14 d (sliding) | |
| Photo target | <= ~200 KB, max ~1280 px | Client-side compression |
| SSE heartbeat / poll fallback | 25 s / 20 s | |
| Priority order | section 4.7 | Lexicographic; weights in `RulesConfig` |
| Walkthrough driver | Sampath, Kandy hill run (ADR 0008) | Ruwan S. (Peliyagoda) as extra account |

Open items to settle (defaults above apply meanwhile): which Designathon snapshot was submitted (README lists departures, including the loader phone layout, Noto Sans Sinhala/Tamil fonts, list-based planning, the NextDrop name, m³ capacity and the Sampath story); hosting choice (see open-questions C3). Web Push is optional and there is no SMS (ADR 0013); reference data may be published (ADR 0011).
