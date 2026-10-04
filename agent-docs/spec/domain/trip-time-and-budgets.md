---
status: draft
owner: Dinura
sources: guide §4.3-4.5
---

# Trip time, budgets, ETAs and fuel

## 4.3 Trip time and budgets (exactly as the Booklet defines; no return leg)

```
trip_minutes = depot_to_district_freeflow_min            (once per trip)
             + inter_stop_freeflow_min * (n_orders - 1)
             + SUM( service_allowance_min[trip brand, outlet dock_type] )
```

| Class | Window | Budget per vehicle per day |
| --- | --- | --- |
| Fresh | 03:30-08:00 | 270 min across that vehicle's Fresh trips |
| Style + Tech combined | Trading day | 480 min across that vehicle's Style/Tech trips |

A vehicle may run one Fresh and one Style trip, each checked against its own budget, but still only 2 trips in total. Validation budgets always use the free-flow formula above (this matches the organisers' checker). Traffic or road-condition adjustments, if any, affect only displayed ETAs and risk, never validity.

## 4.4 ETAs and windows

- Stop ETA = trip departure + outbound travel + sum of (previous stops' service + inter-stop travel). Early arrival waits until the window opens.
- Stops are sequenced by earliest window close first (ties by district order, then order ID). A dispatcher draft preserves its explicit order only on a trip with a departed published stop on the same vehicle and trip number (ADR 0053). The loader sees the reverse sequence (last stop loaded first).
- Fresh trip 1 departs at the Fresh window start (03:30, configurable). **Two ETAs** exist per stop (ADR 0003). The **validation ETA** follows the Booklet formula: trip 2 starts when trip 1's `trip_minutes` have elapsed, with no return leg and no reload buffer; only this ETA can raise `WINDOW_MISSED` or `TIME_BUDGET_EXCEEDED`. The **display ETA** (shown to stores, loaders, drivers) departs trip 2 after trip 1 ends + return (equal to outbound time) + reload buffer. If the display ETA misses a window but the validation ETA does not, the validator emits the warning `LATE_RISK`. Setting `validationEtaIncludesReturn` makes the validation ETA use the display ETA. Style/Tech departure is the earliest time that satisfies all stops' open times (and mall windows) within the trading day: every trip except Fresh trip 1 departs at the later of its earliest start (trading day start, or after trip 1) and the first stop's effective window open minus the outbound time; later stops wait if early (ADR 0020).
- A trip ends when the vehicle leaves its last stop. A stop is on time when unloading starts (after any wait) no later than its effective window close; a window that does not overlap the mall window is never met (ADR 0020).
- Store-facing ETA is shown as a band (`ETA_WINDOW_MIN`, default 30), centred on the display ETA and starting on a 5-minute mark (ADR 0020).

## 4.5 Fuel

`km(trip) = depot_to_district_km * (return ? 2 : 1) + inter_stop_km * (n - 1)`; `litres = km / km_per_l`, rounded up to the whole millilitre (ADR 0020). Weekly use per vehicle is the sum over non-cancelled published trips in the ISO week (Monday reset, matching `calendar.csv iso_year/iso_week`). Computed as a query/view, not a separate mutable ledger. The draft validator receives "fuel already used this week excluding this day's published trips".

Dispatcher drafts preserve their orderIds sequence in validation/display schedules only on trips with a departed published stop on the same vehicle and trip number; all other trips use the default window ordering. This enables departed later-stop resequencing while retaining relative locked-stop order (ADR 0053).

