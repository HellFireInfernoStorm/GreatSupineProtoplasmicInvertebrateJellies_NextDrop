# ADR 0049: AA contrast on four Store and Dispatcher elements

- Status: proposed
- Date: 2026-10-04
- Issue / PR: #134
- Designathon departure: yes

## Context

The axe smoke check (#127, `e2e/tests/accessibility.spec.ts`) found four WCAG 2.1 AA contrast failures in normal-size text, all coloured with Day 5 Figma variables (`agent-docs/design/design-system.md`):

| Screen | Element | Colours | Ratio |
| --- | --- | --- | --- |
| Store home, phone width | Inactive tab bar tabs, 12 px | `--nd-faint` `#9aa3b0` on white | 2.54:1 |
| Dispatcher login | Links, 14 px | Dispatcher `--nd-link` `#2778f8` on white | 4.09:1 |
| Dispatcher dashboard | Page subtitle and control labels, 11–13 px | `--nd-muted` `#6b7585` on `--nd-surface-2` `#f6f9fa` | 4.4:1 |
| Dispatcher dashboard | Info banner text, 11 px bold | `--nd-info` `#1f6bd6` on `--nd-info-bg` `#e5f0ff` | 4.41:1 |

## Decision

Every token keeps its value. Each element uses a darker existing token instead:

- Store inactive tabs: `--nd-muted` (`#6b7585`, 4.66:1 on white).
- Dispatcher login links and the password show/hide link: `--nd-info` (`#1f6bd6`, 5.08:1). In the Store theme `--nd-link` already has this value, so the Store login is unchanged.
- Dispatcher page subtitle and the Depot and Date labels: `--nd-neutral` (`#465264`, 7.49:1 on `#f6f9fa`). `.dispatch-muted` elsewhere is unchanged.
- Dispatcher banners (11 px): the text uses `--nd-text`, and the background tint and icon keep the tone colour. This applies to every tone, because the other tone colours sit as close to 4.5:1 on their tints at this size.

The colours visible in the Day 5 design change for these elements, so this is a Designathon departure.

## Alternatives considered

- **Darken the token values** (`--nd-faint`, the Dispatcher `--nd-link`, `--nd-muted`, `--nd-info`). This would move every use of the token away from Figma, including uses that already pass, such as large text and icons.
- **Keep the `known` expected failures.** AA contrast is a submission requirement, and the entries were meant to go with the fix.

## Consequences

- The four `known` entries are removed from `e2e/tests/accessibility.spec.ts`, so a regression on these screens fails the run.
- The README's departures list gains an item.
- The spec is unchanged: `spec/frontend/design-system.md` already requires AA, and the token files still mirror Figma.
