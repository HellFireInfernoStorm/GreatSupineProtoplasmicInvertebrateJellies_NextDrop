---
status: draft
owner: Dinura
sources: guide §4.8
---

# Units and time conventions

## 4.8 Units and time conventions

- Rules core works in integers: weight in grams, volume in litres (input kg/m3 rounded to 3 decimals), so capacity comparisons are exact.
- Clock times are `HH:MM` 24-hour, Asia/Colombo. Rules core uses minutes since local midnight.
- All instants stored as UTC `timestamptz`. Delivery dates are local dates.
- UI shows two timestamps for field facts, never merged: "Delivered 06:12 · confirmed 07:40 after sync".
- Capacity and forecast volumes are m³ (stored as litres, shown as m³). Tonnes may appear only as a secondary label (ADR 0010).
