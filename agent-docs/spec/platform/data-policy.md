---
status: draft
owner: Dinura
sources: guide §20, ADR 0011
---

# Data policy and Datathon overlap

- **Decision (ADR 0011)**: the shared general reference files may be committed to the repository and seeded on the public deployment: outlets, vehicles, calendar, district travel, service allowance, traffic speed and road conditions, under `data/reference/`. The approved file names are enforced by `scripts/agent-context/config.json`.
- **Never** commit or seed Training/Test files, the peak-day scenario/fleet files, or organiser scripts. All orders and history are synthetic and generated.
- Datathon Task 2B overlap: `packages/rules` ships a small CLI (`pnpm rules:allocate --scenario <csv> --out <csv>`) so the same allocator can produce the Task 2B CSV from locally held files. The written policy uses the `DeferralExplanation` output. OR-Tools MAY be used in a notebook as an offline benchmark. None of this is part of the Hackathon build.
