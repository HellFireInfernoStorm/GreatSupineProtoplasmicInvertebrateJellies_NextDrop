# Design context

Derived from the Day 5 Figma design and checked against the live file on 2 Oct 2026. The latest version of the Figma file is the source of truth; when this folder and the file disagree, the file wins and the doc is fixed (ADR 0015). The file can be read with the Figma MCP tools, but it is not being edited for now.

| File | Title | Holds |
| --- | --- | --- |
| [product-and-roles.md](product-and-roles.md) | Product, roles and design trade-off | One plan four views, personas, ranked problems, what was left out, core trade-off. |
| [screens.md](screens.md) | Screen inventory and per-app walkthrough | Fourteen core screens plus extras; what each app shows. |
| [design-system.md](design-system.md) | Design system | Themes, variable collections, text styles, status language, components, copy rules. |
| [mock-story.md](mock-story.md) | Shared mock story | The one day every screen tells (cast, orders, plan numbers). |
| [degradation-scenario.md](degradation-scenario.md) | Degradation scenario: dead zone on the hill run | Scenario, recovery rules, driver and store flows. |
| [prototype-flows.md](prototype-flows.md) | Prototype flows and login screens | Flow starting points, wiring, login design. |
| [figma-reference.md](figma-reference.md) | Figma file map and tooling notes | Page and node map, Figma API lessons, quick reference. Only needed when editing Figma. |
| [known-gaps.md](known-gaps.md) | Other artefacts and known gaps | Open items in the design, Figma defects, closed items. |

## Source note

Copied from the head of the original design context file, written by Chethaka (`@lakwan194`). Node IDs and file keys refer to the team's Figma file. Paths refer to the design-stage machine, not to this repository. The quoted block below is historical; `figma-reference.md` has the current file map.

> Everything designed so far for the Rootcode Tech-Triathlon 2026 Designathon entry, written so that a person or an AI assistant who has never seen the project can pick it up. It covers the product idea, the four apps, the shared design system, every screen and prototype flow in Figma, the degradation scenario, the mock story data, known gaps, and the Figma API lessons learned.
>
> - **Last updated:** 30 Sep 2026
> - **Figma file:** "Delivery-App-UI", file key `BUan1C6oFA7OTc9o6cCQxv`
> - **Repo:** `/home/lakwan/Desktop/RootCode` (git, branch `main`, one commit). Source documents in the repo: `Designation Blueprint.pdf`, `Challenge Booklet.pdf`, `loader-screens-spec.md`, `mock data/data/` (CSV datasets), `GreatSupineProtoplasmicInvertebrateJellies_NextDrop/README.md` (empty team repo, only a README).
> - **Naming:** our pages say **Waypoint**. The friend's original Dispatcher page brands the product **NextDrop**, and the team repo folder ends in `_NextDrop`. Not resolved. Ask before renaming anything.
> - **Deadlines (from the Blueprint):** design submission due 29 Sep 2026, 11:59 PM (target 9 PM). Deliverables: one Figma file with distinct pages, rationale paragraph per screen, trade-off page, AI disclosure, 3–5 minute unlisted YouTube video, zipped as `TeamName_Designathon.zip`. The build team then has until 4 Oct for the Hackathon.
>
> > **Confidence note.** Screen contents, node IDs and numbers below were read from the Figma file or built in this project. Where something is an assumption or placeholder it says so. Mock IDs (OUT0xx, VEH0xx etc.) are placeholders: the real `outlets.csv` and `vehicles.csv` exist in `mock data/data/General Data/` but have **not** been used to replace them.
>
> ---
