// Demo tooling (spec/data/seed-and-demo.md §15.2): server clock control, tick and reset. Only with DEMO_MODE=true.
export { BEFORE_CUTOFF_TIME, resetToBeforeCutoff, type ResetDependencies } from "./reset";
export { demoRoutes, type DemoRouteDependencies } from "./routes";
