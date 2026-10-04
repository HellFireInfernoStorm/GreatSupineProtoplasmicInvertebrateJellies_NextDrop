# e2e: running the walkthrough

Playwright drives the built app in a real browser against a running stack. Nothing here starts the stack.

```bash
docker compose up -d --build     # the stack, on http://localhost:8080
pnpm e2e:install                 # once: Playwright's Chromium (needs sudo for system libraries)
pnpm e2e                         # the walkthrough (twice) and the axe smoke checks
```

| Variable              | Default                 | Use                                                                             |
| --------------------- | ----------------------- | ------------------------------------------------------------------------------- |
| `E2E_BASE_URL`        | `http://localhost:8080` | The stack to test: another local port, or the public deployment.                |
| `E2E_BROWSER_CHANNEL` | (Playwright's Chromium) | `chrome` uses the installed Google Chrome, so `pnpm e2e:install` is not needed. |

For a stack of your own beside the default one (`agent-docs/process/collisions.md`):

```bash
printf 'APP_PORT=8162\n' > .env.local
docker compose -p wp-62 --env-file .env.local up -d --build
E2E_BASE_URL=http://localhost:8162 E2E_BROWSER_CHANNEL=chrome pnpm e2e
```

**Every run resets the demo data** of the stack it points at (`POST /api/demo/reset`). On the public deployment every judge sees that reset (ADR 0007). The GitHub workflow `e2e-public` runs the suite against a URL you give it.

**If step 10 fails on "No signal"**, the database holds another device that signed in as the driver `DRV039` and sent nothing. Signing in stamps a device with the real time, which is ahead of the demo clock, so the truck never looks silent. The suite always signs in as that driver from one fixed phone to avoid this. Start from an empty database (`docker compose down -v`, then up) and run again.

## What is here

| Path                                                               | What it is                                                                                                                  |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `tests/walkthrough.spec.ts`                                        | The 14 steps of `seed-and-demo.md` §15.4, one test per step, in order. A step whose screens are not merged is `test.fixme`. |
| `tests/accessibility.spec.ts`                                      | The axe smoke check: each role's login screen and first screen, at the width the role is judged at.                         |
| `support/fixtures.ts`                                              | The `test` to import: it adds `demo` (reset, clock) and the two options that differ between the walkthrough's runs.         |
| `support/demo.ts`, `support/api.ts`                                | The demo endpoints, called as the dispatcher.                                                                               |
| `support/signIn.ts`, `support/accounts.ts`, `support/viewports.ts` | One signed-in window per role, at phone, tablet or desktop width.                                                           |
| `support/offline.ts`                                               | Going offline both ways: the in-app force-offline switch and the browser's offline mode.                                    |
| `support/axe.ts`                                                   | The accessibility assertion.                                                                                                |

## The two walkthrough runs

The walkthrough runs as two Playwright projects, so that between them the acceptance criteria of #62 are covered:

| Project                              | Loader width (step 7) | Driver goes offline by (step 9) |
| ------------------------------------ | --------------------- | ------------------------------- |
| `walkthrough-phone-force-offline`    | phone                 | the in-app force-offline switch |
| `walkthrough-tablet-browser-offline` | tablet                | the browser's offline mode      |

The Driver is always at phone width. Tests run one at a time: there is one database and one demo clock.

## Turning a `fixme` step into a real one

1. Replace `test.fixme(...)` with `test(...)`. Keep the title: it is the step's wording in §15.4 and in the root README.
2. Open the role's window with `signIn` in the first step that needs it, and keep it in the `describe` scope for later steps.
3. Remove any stand-in the step replaces: a later step that does an earlier fixme step's work says so in a comment.
4. If the step fails because the feature does not match §15.4, comment on the feature's issue. Do not weaken the step.
