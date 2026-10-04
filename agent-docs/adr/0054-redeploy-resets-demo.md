# ADR 0054: A redeploy resets the public demo to a preset

- Status: accepted
- Date: 2026-10-04
- Issue / PR: #33
- Designathon departure: no

## Context

ADR 0051 made a redeploy `git pull && docker compose up -d --build`. The seed runs on every start but creates operational rows only when they are missing and never moves the demo clock (ADR 0030). The deployed demo therefore did not open on the story day:

- On a fresh database the clock reads real time, days after Tue 29 Sep 2026, so the seeded orders sit in the past and no planning day is open for them.
- On an existing database a redeploy keeps whatever state earlier testing left, and story fixtures added since the first boot never reach it.

Dinura wants every update of the public deployment to open on the seeded demo day.

## Decision

`docker/redeploy.sh` is the redeploy command, and `docker/droplet-init.sh` ends by running it:

1. `git pull --ff-only`, then `docker compose up -d --build`. A failed build stops the script.
2. Wait for `GET /api/healthz` on `APP_PORT`. The API listens only after the seed has finished.
3. `POST /api/demo/reset` with `DEMO_SCRIPT_KEY` from `.env`. The preset is the first argument, else `DEMO_DEPLOY_PRESET` in `.env`, else `before-cutoff`. A preset that is not built yet fails the script with the 409.

`--keep` deploys without a reset. The app is unchanged: a restart (reboot, crash, `docker compose restart`) still only runs the idempotent seed, so judges' progress survives anything but a deliberate deploy.

When `plan-published` and the later presets ship (#56), setting `DEMO_DEPLOY_PRESET` makes a deploy open with published trips for the Loader and the Driver.

Amended 2026-10-04 by [ADR 0055](0055-hourly-demo-reset.md): the reset moved into `docker/reset-demo.sh`, which an hourly cron job also runs, and the default preset is `orders-closed`.

## Alternatives considered

- **Reset on every app start** (an env var read in `main.ts`): simpler to trigger, but a crash or a droplet reboot during judging would wipe every judge's progress. It also reverses ADR 0030's rule that a restart never reverts demo progress.
- **Wipe the database volume on each deploy**: the clock is still not moved, sessions are lost, and `down -v` also deletes Caddy's certificates (Let's Encrypt rate limits).
- **Seed the clock and planning days on a fresh database**: fixes only the first boot. Redeploys onto an existing database keep stale state.
- **Reset by hand after each deploy**: one curl, but easy to forget on the deadline night.

## Consequences

- A deploy resets the demo for everyone using the public URL at that moment. The reset banner says so (ADR 0007), and field devices drop queued work through the reset epoch. Deploy outside judging windows, or pass `--keep`.
- The droplet's `.env` must keep a non-empty `DEMO_SCRIPT_KEY`; the init script generates one.
- Spec edits in this PR: `spec/platform/deployment.md` (first boot, redeploy, `DEMO_DEPLOY_PRESET`). ADR 0051 carries an amendment note.
