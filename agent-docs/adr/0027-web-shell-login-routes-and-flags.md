# ADR 0027: Web shell login routes, build flags and login-screen departures

- Status: proposed
- Date: 2026-10-03
- Issue / PR: #36
- Designathon departure: yes (label `designathon-departure`)

## Context

Issue #36 builds the web shell and the login screens. Four things were open or not drawn:

- [frontend/architecture.md](../spec/frontend/architecture.md) named one `/login` route. The design has a different login screen per app and no screen for choosing a role.
- The quick-login chips must show "when `DEMO_MODE` is on". The only endpoint that reports demo mode, `GET /api/demo/state`, needs a dispatcher session, so the login page cannot call it.
- Screens have to be built before their endpoints exist.
- The login frames show details the build cannot know before sign-in, and lack details the spec requires.

## Decision

1. **Login routes.** One login screen per role: `/login/store`, `/login/dispatch`, `/login/loader`, `/login/driver`. `/` and `/login` redirect a signed-in user to their role's routes, and anyone else to the login screen the device used last (Store on a first visit). No role-chooser screen is added. A signed-out visitor who opens a role's routes lands on that role's login.
2. **Build flags.** `VITE_DEMO_MODE=true` shows the quick-login chips. `VITE_API_MOCK=true` answers every API call from the contract fixtures. Both are read at build time. The image build sets `VITE_DEMO_MODE` to match the server's `DEMO_MODE`.
3. **Role routes live with the role.** Each role shell declares the routes below its group in its own folder, so roles do not edit the shared router.
4. **Token aliases.** Tailwind's default colour palette is removed, so colours come from the tokens only. Where a Figma collection has no variable for a tone, the token borrows one: chilled uses info in the light themes, deferred uses info in the dark themes, and neutral in the dark themes is the muted text on the raised surface.
5. **Departures on the login screens:**
   - The Driver login has the language chips. The frame `525:7860` has none; the spec requires them on Loader and Driver.
   - The Loader and Driver subtitles show the role only. The frames show "Loader · Peliyagoda DC · Dock 3" and "Driver · Kandy hub", which are not known before sign-in.
   - The Dispatcher panel shows the NextDrop wordmark in place of the "Waypoint" mark, and panel footers say NextDrop (ADR 0012).
   - In demo mode the quick-login chips appear under each form. They are not drawn.
   - Below 1024 px the Loader login is one column with the keypad under the PIN (ADR 0002).
   - "Forgot password?" has no reset flow behind it. On the Store login it changes the help line to the "call dispatch" wording; on the Dispatcher login it points at the "ask your depot admin" line. This follows the rationale cards.

## Alternatives considered

- One `/login` with a role chooser: a screen the design does not have.
- A public config endpoint that reports demo mode: needs a contract and API change. It can replace the build flag later without touching the screens.
- Mock Service Worker for mock mode: a new dependency, and its service worker would compete with the PWA's own.

## Consequences

- Spec edited: `frontend/architecture.md`, `frontend/design-system.md`.
- The Dockerfile (#31) must pass `VITE_DEMO_MODE` when it builds the web app.
- The quick-login accounts are placeholders that mirror the contract fixtures until the story fixtures (#24) and the seed (#30) land. They live in one file, `apps/web/src/login/demoAccounts.ts`.
- The guards need `/auth/me`. The offline core (#40) must keep the session on the device so a Loader or Driver can start the app without signal.
- **Open: "Keep me signed in".** The checkbox is drawn on the Store and Dispatcher logins, but the login contract has no such field and session lifetime is fixed per role. It is rendered and has no effect. The owner decides whether the contract gains the field or the checkbox is removed (a further departure).
