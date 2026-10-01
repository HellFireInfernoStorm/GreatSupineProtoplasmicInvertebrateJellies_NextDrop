---
status: draft
owner: Dinura
sources: guide §20
---

# Data confidentiality and Datathon overlap

- The Booklet's terms forbid sharing or publishing the datasets or derivatives, while the Hackathon requires a seeded public deployment. Seed **only** the shared/general reference files (outlets, vehicles, calendar, district travel, service allowance, traffic, road conditions). **Never** commit or seed Training/Test files, the peak-day scenario/fleet files, or organiser scripts. All orders and history are synthetic and generated.
- Confirm with the organisers (tech-triathlon@rootcode.io) that publishing the shared reference data in the repo and deployment is acceptable; until confirmed, keep the repository private with judge access.
- Datathon Task 2B overlap: `packages/rules` ships a small CLI (`pnpm rules:allocate --scenario <csv> --out <csv>`) so the same allocator can produce the Task 2B CSV from locally held files. The written policy uses the `DeferralExplanation` output. OR-Tools MAY be used in a notebook as an offline benchmark. None of this is part of the Hackathon build.
