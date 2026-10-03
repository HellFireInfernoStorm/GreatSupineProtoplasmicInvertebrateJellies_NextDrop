---
status: draft
owner: Dinura
sources: guide §14, §14.1
---

# Frontend architecture

## 14.1 Shells and routes

One SPA. Route groups `/store/*`, `/dispatch/*`, `/loader/*`, `/driver/*`, plus one login screen per role: `/login/store`, `/login/dispatch`, `/login/loader`, `/login/driver` (ADR 0031). `/` and `/login` redirect a signed-in user to their role's routes, and anyone else to the login screen the device used last.

Route guards use `/auth/me`, asked once when the app loads; after that they use the session the app holds, so navigation works with no signal. A signed-out visitor who opens a role's routes is sent to that role's login. A signed-in user who opens another role's routes is sent to their own. A Store or Dispatcher shell leaves for the login screen when its session is lost later (a 401, or sign-out). A Loader or Driver shell stays on a 401 and asks for the PIN ([offline-client.md](../sync/offline-client.md)).

The guards also set the language before a screen renders: the device's chosen language on Loader and Driver routes, English on Store and Dispatcher routes.

Each role shell is a lazily loaded chunk; the **driver and loader chunks are precached** by the service worker, the others are runtime-cached. A shell declares the routes below its group in its own folder (`src/roles/<role>/index.tsx`), so a role's screens are added there and not in the shared router. A shell sets `data-theme="store|dispatcher|loader|driver"` on its root and renders the demo reset banner (ADR 0007) above its screens.

Screen inventory. The authoritative list and visuals are the live Figma file (ADR 0015), summarised in `design/screens.md`.

- **Store:** sign-in; my deliveries; place order with the outlet brand's product catalogue; review and submit; order placed; deferral notice; order tracking, timeline, history and detail; confirm receipt; report issue; notifications; the "late or lost?" sheet.
- **Dispatcher:** sign-in with depot; dashboard (D0); order queue (D1); plan board (D2) with the add-trip modal in valid and blocked states; defer and publish (D3); Delivery Progress (D4, the live run monitor, route `/dispatch/runs`, with exceptions inbox and evidence detail); capacity outlook (D5); fleet and capacity; notifications popover; confirmation toasts.
- **Loader:** PIN sign-in with language chips; trips by departure; loading checklist in reverse stop order; short and damaged sheets; ready and hand-over with hold-to-confirm; connection and plan-changed states.
- **Driver:** PIN sign-in; today's run; stop detail; flag a problem; outcome and proof of delivery; sync, offline, reconnect, clash and plan-changed states; settings with sync diagnostics.

## 14.3 Conventions

- **Outlet grouping** (ADR 0010): accounting stays per order, but Driver and Store views group adjacent stops of one outlet and trip into one card with expandable order rows. A card is done when all its orders are confirmed. Trip time still counts service time per order.
- **Brand ordering guidance** (ADR 0010): the store order screen shows the notice from `orderingGuidance(brand, date, calendar)` (Style weekly day, Fresh chilled days, Tech single items). It is a notice only and never blocks submission. The seed obeys the same rule except on purpose.
- **Capacity in m³**: the capacity outlook and its axes use m³. Tonnes may appear as a secondary label.

## 14.4 Shared plumbing

Every screen uses these, from `apps/web/src/lib`:

- **API client**: `callApi(routeName, { params, query, body })`. The route names, paths and types come from the route table in `packages/contracts` ([api-dtos.md](../platform/api-dtos.md)). It checks the request and the response against the contract, adds the CSRF header to mutations, and rejects with `ApiRequestError` (`kind` is `http`, `network` or `invalid`).
- **Mock mode**: a build with `VITE_API_MOCK=true` answers every call from the contract fixtures, so a screen can be built before its endpoint exists. Sign-in keeps a mock session for the tab. The password `wrong` or PIN `0000` gives the wrong-credentials answer; `locked` or `9999` gives the locked answer.
- **Session**: `useSession()` inside a role shell. `signIn`, `signOut` and `reauth(pin)` change it; `useReauthNeeded()` is true while a Loader or Driver must enter the PIN again. `reauth` keeps the session on a wrong PIN or a lockout, and drops it when the server answers `UNAUTHENTICATED`, because no PIN can renew it then. Sign-out rejects, and the user stays signed in, when the server cannot be reached. Sign-in, sign-out and a lost session drop everything else in the query cache, so the next user of a shared device starts clean.
- **Server clock**: `useServerNow()` for every countdown, ETA and displayed "now". The offset is learned from the `serverTime` of API responses; `clockOffsetMs()` gives it to field events.
- **Demo**: a build with `VITE_DEMO_MODE=true` shows the quick-login chips. `setDemoNotice()` feeds the reset banner.
- **Desktop or phone design**: a role with both designs (the Store) uses the desktop design from 1024 px wide (Tailwind `lg`) and the phone design below it. A tablet held upright therefore gets the phone design, kept at phone width and centred. Use `lg:` classes where the two designs differ in layout, and `useIsDesktop()` where they need different components. The `short:` variant tightens spacing on a small or sideways phone.
