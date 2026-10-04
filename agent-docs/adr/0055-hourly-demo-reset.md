# ADR 0055: Reset the public demo every hour

- Status: accepted
- Date: 2026-10-04
- Issue / PR: #33
- Designathon departure: no

## Context

ADR 0054 resets the public demo on each deploy. The demo clock is real time plus an offset (ADR 0033), so it keeps running after a reset. Ten real hours after a `before-cutoff` reset it passes midnight into Tue 29 Sep. The Dispatcher then opens on Wed 30 Sep, which has no seeded orders, and a few days later every seeded order is in the past.

Judges will open the public URL at unknown times over several days. The walkthrough expects them to reset the demo and move the clock themselves, but the demo panel that would let them is not built yet (#56).

Drafts are refused while a day is still open for orders (`errors.dayNotPlannable`). A demo that stays at `before-cutoff` (Mon 14:00) would never reach the 16:00 cutoff, so without the panel a judge could never plan.

## Decision

- `docker/reset-demo.sh` resets the demo through `POST /api/demo/reset` with the script key, after waiting for `/api/healthz`. `docker/redeploy.sh` now calls it instead of doing the reset itself.
- `/etc/cron.d/nextdrop-demo-reset` runs `docker/reset-demo.sh` as root every hour, on the hour, and appends to `/var/log/nextdrop-demo-reset.log`.
- `docker/redeploy.sh` installs the cron file on every run (`reset-demo.sh --install-cron`). It removes the file instead when `.env` has `DEMO_RESET_HOURLY=false`. The droplet init script runs `redeploy.sh`, so a new droplet gets the job too.
- The default preset for both deploys and the hourly job is `orders-closed`: Mon 28 Sep 16:05, Dilini's step-1 orders placed, both depots' Tue 29 Sep closed and ready to plan. The demo clock therefore always reads between Mon 16:05 and 17:05. The Dispatcher opens on Tue 29 Sep with its queue, and stores can order for Wed 30 Sep. `DEMO_DEPLOY_PRESET` in `.env` overrides it, for example `plan-published` once #56 ships it.
- A lock (`flock`) keeps the hourly job and a redeploy from resetting at the same time.

## Alternatives considered

- **Freeze the demo clock between resets:** a code change to the clock (ADR 0033). A frozen `before-cutoff` never reaches the cutoff, so planning stays blocked, and judges cannot move the clock without the panel.
- **Reset once a day:** the demo clock would still drift up to a day, past midnight, into an empty Wed 30 Sep.
- **Reset only when nobody is active:** no reliable activity signal. Open SSE connections and the per-minute tick keep the server busy whether or not a judge is working.
- **Keep `before-cutoff` as the default:** with an hourly reset the clock never passes 15:00 on Monday, so a judge could never propose a plan.

## Consequences

- Whenever judges arrive, the demo is within an hour of the story day, with the Dispatcher's queue ready to plan.
- A judge mid-walkthrough loses their progress on the hour. The reset banner (ADR 0007) shows it, and field devices discard queued work through the reset epoch. Once the demo panel ships (#56), judges can reset themselves, and `DEMO_RESET_HOURLY=false` turns the hourly job off.
- Walkthrough step 1 (a store order before Tuesday's cutoff) needs `before-cutoff`. The hourly default skips past it, so Dilini's step-1 orders are already placed.
- Amended 2026-10-04 (#56): the default preset is `plan-published`, which also proposes and publishes the stock plan for both depots, so the Loader and the Driver have trips.
- Spec edits in this PR: `spec/platform/deployment.md` (redeploy, demo reset, hourly reset, environment). ADR 0054 carries an amendment note.
