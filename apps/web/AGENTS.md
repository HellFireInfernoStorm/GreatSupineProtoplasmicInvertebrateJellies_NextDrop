# apps/web: Vite PWA with four role shells

Read first: [spec/frontend](../../agent-docs/spec/frontend/README.md), [offline-client.md](../../agent-docs/spec/sync/offline-client.md), [design/](../../agent-docs/design/README.md).

- Code lives in `src/roles/{store,dispatcher,loader,driver}/`, shared kit in `src/ui/`, offline core in `src/sync/`.
- Never import from `apps/api` or Prisma. Use `packages/contracts` types and `packages/rules` for live checks.
- Colours, type and spacing come from the per-role design tokens (`data-theme="store|dispatcher|loader|driver"`). Do not hard-code colours that have a token.
- Loader and Driver read from Dexie, never directly from the network. Writes go to the outbox. Never use `localStorage` for the outbox.
- Offline is amber, never red. Field facts show two timestamps, never merged ("Delivered 06:12 · confirmed 07:40 after sync").
- Every user-facing string is an i18n key (`en`, `si`, `ta` for Loader and Driver). Layouts must tolerate Tamil strings that run about 40 percent longer.
- Loader must work in single-column phone layout as well as tablet. Driver is designed at 360x800.
- Countdowns and ETAs use the server clock offset, not the device clock.
- UI differing from the Day 5 design is a departure: add the label `designathon-departure` and an ADR.
