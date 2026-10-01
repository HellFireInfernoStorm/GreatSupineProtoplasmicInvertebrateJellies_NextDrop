---
status: draft
owner: Dinura
sources: guide §16
---

# Prediction providers

Two interfaces keep the UI honest and swappable:

- `RiskProvider.lateRisk(stop) -> { level, probability }`: default heuristic from ETA slack to window close, adjusted by `traffic_speed`, `road_conditions` disruption and monsoon flag. Labeled as an estimate in the UI.
- `ForecastProvider.weeklyVolume(depot, brand, week) -> { total_m3, chilled_m3 }`: default seasonal/moving-average blend over `WeeklyDemandHistory` with payday and festival-ramp multipliers; drives the capacity outlook. Chilled is Fresh only.

The Datathon is judged separately; plugging its models in is out of scope for the build and may be restricted by the data terms.
