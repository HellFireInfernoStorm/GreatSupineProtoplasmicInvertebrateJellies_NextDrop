---
status: draft
owner: Dinura
sources: guide §14.2
---

# Frontend design system

## 14.2 Design system

- **Tokens**: Figma variable collections exported to CSS custom properties per theme (`theme/tokens.{store,dispatcher,loader,driver}.css`). Store and Dispatcher are light (Inter); Loader and Driver are dark (Noto Sans, with Noto Sans Sinhala/Tamil, self-hosted). Tailwind maps semantic names (`surface`, `text`, `muted`, `border`, `primary`, `ok`, `warn`, `danger`, `info`, `chilled`, `deferred`, `neutral`) to those variables, so components are theme-agnostic. The mapping is in `apps/web/src/index.css`. Tailwind's default colour palette is removed, so a colour class exists only for a token. Each status tone has three tokens: the tone, `-fg` for text on a tinted background, and `-bg` for the tint. Where a Figma collection has no variable for a tone it borrows one: chilled uses info in the light themes; deferred uses info, and neutral uses the muted text, in the dark themes (ADR 0031).
- **Component kit** in `apps/web/src/ui` mirrors Figma component sets (Button, StatusPill, TimelineCard, CapacityBar, TripCard, StopCard, SyncPill, Banner, Sheet/Modal, HoldToConfirm, QuantityStepper, Toast, EmptyState, FormField). One timeline component is used by all four roles.
- **Status vocabulary** maps one-to-one to order status (section 1.1) and to tone tokens; chilled is always marked distinctly.
- **Copy and format rules**: 24-hour times; IDs in monospace; plain language; offline is amber, never red; two timestamps for field facts, never merged; destructive or irreversible actions (mark trip ready) use hold-to-confirm in field roles.
- **Sizes**: Driver 360x800; Loader landscape tablet 1280x800 **with a mandatory single-column phone layout** (the Booklet says judges assess loader on phone screens; this is a departure from the tablet-only design and MUST be listed in the README); Store 390x844 and desktop; Dispatcher >= 1440 wide. Field roles use large touch targets and high contrast as specified in the design.
- **Localization**: Loader and Driver ship `en`, `si`, `ta` with a language chip; Tamil strings run long, so layouts must not assume English widths. Locale files are `apps/web/src/i18n/locales/<language>/<role>/<namespace>.json`, one per role and namespace, and a screen reads them with `useTranslation("<role>/<namespace>")`. Every string carries a review state in the locale files (`reviewed` or `draft`): `en` holds plain strings, and `si` and `ta` hold `{ "text": …, "review": … }` for each one. The core vocabulary (statuses, buttons, errors) is reviewed by a native speaker before submission; the README lists strings still `draft`. A Playwright check renders the Loader in `ta` at phone width and fails on clipped text. Store and Dispatcher are English.
- **Planning interaction default**: assign/move via menus ("Move to...") backed by the validator; drag-and-drop (dnd-kit) is optional polish.
- **Server time**: countdowns (cutoff) and ETAs use the server clock offset, never the device clock.
