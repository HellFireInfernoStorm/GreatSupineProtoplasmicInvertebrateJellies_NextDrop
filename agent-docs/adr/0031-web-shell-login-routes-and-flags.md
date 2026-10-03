# ADR 0031: Web shell login routes, session handling, build flags and login-screen departures

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
5. **Session.** `GET /auth/me` is asked once, when the app loads. After that the guards use the session the app holds, so moving between screens never waits on the server and works with no signal. The session changes only through sign-in, sign-out, PIN reauth, or a 401 from a session route. That 401 signs a Store manager or Dispatcher out. For a Loader or Driver it keeps the session and raises a reauth-needed state, as [offline-client.md](../spec/sync/offline-client.md) requires; a 401 from `/auth/reauth` itself is a wrong PIN and changes nothing. Sign-out that cannot reach the server leaves the user signed in and says so, because the session cookie would still be valid.
6. **Departures on the login screens:**
   - The Driver login has the language chips. The frame `525:7860` has none; the spec requires them on Loader and Driver.
   - The Loader and Driver subtitles show the role only. The frames show "Loader · Peliyagoda DC · Dock 3" and "Driver · Kandy hub", which are not known before sign-in.
   - The Dispatcher panel shows the NextDrop wordmark in place of the "Waypoint" mark, and panel footers say NextDrop (ADR 0012).
   - In demo mode the quick-login chips appear under each form. They are not drawn.
   - Below 1024 px the Loader login is one column with the keypad under the PIN (ADR 0002).
   - "Keep me signed in" is not shown. The login contract has no such field and session lifetime is fixed per role, so the checkbox could not do anything.
   - "Forgot password?" has no reset flow behind it. On the Store login it changes the help line to the "call dispatch" wording; on the Dispatcher login it points at the "ask your depot admin" line. This follows the rationale cards.

## Alternatives considered

- One `/login` with a role chooser: a screen the design does not have.
- A public config endpoint that reports demo mode: needs a contract and API change. It can replace the build flag later without touching the screens.
- Mock Service Worker for mock mode: a new dependency, and its service worker would compete with the PWA's own.

## Consequences

- Spec edited: `frontend/architecture.md`, `frontend/design-system.md`.
- The Dockerfile (#31) must pass `VITE_DEMO_MODE` when it builds the web app.
- The quick-login chips sign in as the seed's four judge accounts. The web app may not import from the API, so `apps/web/src/login/demoAccounts.ts` repeats their login IDs and demo credentials from `apps/api/prisma/seed/accounts.ts`; the two files change together.
- A first load with no signal has no session to use, and shows the retry screen. The offline core (#40) must keep the session on the device so a Loader or Driver can start the app without signal. It also builds the PIN prompt for the reauth-needed state and pauses sync while it is up.
- If the login contract gains a "keep me signed in" field, the checkbox returns as drawn.
