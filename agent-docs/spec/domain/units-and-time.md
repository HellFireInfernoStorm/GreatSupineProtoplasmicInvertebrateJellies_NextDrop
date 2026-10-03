---
status: draft
owner: Dinura
sources: guide §4.8
---

# Units and time conventions

## 4.8 Units and time conventions

- Rules core works in integers: weight in grams, volume in litres, distance in metres, fuel in millilitres and fuel economy in metres per litre (reference-data input kg, m3, km, L, km/L rounded to 3 decimals), so capacity and quota comparisons are exact (ADR 0018).
- Clock times are `HH:MM` 24-hour, Asia/Colombo. Rules core uses minutes since local midnight.
- All instants stored as UTC `timestamptz`. Delivery dates are local dates.
- UI shows two timestamps for field facts, never merged: "Delivered 06:12 · confirmed 07:40 after sync".
- Capacity and forecast volumes are m³ (stored as litres, shown as m³). Tonnes may appear only as a secondary label (ADR 0010).

Proposed precision exception (ADR 0023, pending owner approval): product and order-line unit snapshots use six decimal places in kg/m³. Aggregate quantity times those exact decimal snapshots first, then ceil the final totals once to integer grams/litres for order storage and rules inputs. This keeps a positive small-item order positive and prevents capacity undercounting. Reject totals outside PostgreSQL's positive Int range (1 through 2147483647). Existing reference-data rounding helpers are unchanged.
