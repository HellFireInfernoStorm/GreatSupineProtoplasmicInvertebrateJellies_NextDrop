# ADR 0039: Store place-order screens: routes and departures

- Status: proposed
- Date: 2026-10-04
- Issue / PR: #43
- Designathon departure: yes (label `designathon-departure`)

## Context

Issue #43 builds the Store shell and the place-order flow (S1) from the Figma frames: desktop `230:332`, `232:326`, `233:804`; phone `248:1062`, `248:1168`, `248:1301`, `249:1133`. Three things in the frames have nothing behind them in the contracts, or conflict with a rule the repository already has.

## Decision

1. **Routes.** `/store/order` (place order), `/store/order/items` (the catalogue: "Products" on desktop, "Add items" on phone), `/store/order/review` and `/store/order/placed` (phone only). On desktop the order summary on the place-order screen does the review, and the confirmation is a dialog over it, as drawn.
2. **One order per temperature.** "Submit 2 orders" sends one `POST /store/orders` per temperature (ADR 0032). Each carries an idempotency key that is kept while the order's content is unchanged, so a retry after a failure returns the order the server already holds.
3. **The delivery date rolls forward.** Five dates are offered from tomorrow on the server clock. A non-operating day, or a day whose cutoff has passed, cannot be picked; the order then goes to the first date still open. `packages/rules` decides this in the browser, and `GET /store/cutoff` stays the authority for the cutoff shown.
4. **Departures from the frames:**
   - **"Notes for the dispatcher" is not shown.** `createOrderRequest` has no note field, so the text would be dropped.
   - **Times are 24-hour** ("closes 16:00"). The frames say "4:00 PM"; the copy rule is 24-hour `HH:MM` (`design/design-system.md` §3.7).
   - **The sidebar footer has a "Sign out" link.** The frames draw no way to sign out.
   - **"Add" on the Products screen starts from last week's quantity**, or one if there was none. The frames show the button but not what it sets.
   - **The phone bottom nav reads "My deliveries · Place order · Track · History"**, as the live frames do. Issue #43 says "Receipt" for the third item; the frames win (ADR 0015).

## Alternatives considered

- A `note` field on the order: a contract and schema change, and a place in the dispatcher's queue to show it. It can return with the field.
- Keeping "4:00 PM": two time formats in one product.

## Consequences

- Spec edited: `frontend/architecture.md`.
- On the real stack the screens need the reference API (#110): products, the outlet and the calendar. Until it exists they show the catalogue only in mock mode.
- Mock mode has a small Fresh catalogue, last week's orders and working order placement (`apps/web/src/lib/api/mockStore.ts`), because the contract fixtures hold one product and one order.
- My deliveries, tracking, history and the notifications panel stay with #44. Their nav entries lead to the stand-in screen until then.
