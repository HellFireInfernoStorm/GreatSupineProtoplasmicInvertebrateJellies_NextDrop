import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PLANNING_DAY_STATES } from "@nextdrop/contracts";
import { PlanningDayState } from "../generated/prisma/enums";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("planning-day state storage vocabulary", () => {
  it("keeps Prisma and the generated client aligned with contracts", () => {
    const schema = read("../../prisma/schema.prisma");
    const values = schema
      .match(/enum PlanningDayState\s*\{([^}]+)\}/)?.[1]
      ?.trim()
      .split(/\s+/);
    expect(values).toEqual(PLANNING_DAY_STATES);
    expect(Object.values(PlanningDayState)).toEqual(PLANNING_DAY_STATES);
  });

  it("keeps the stored lifecycle and model documentation aligned", () => {
    const cutoff = read("../../../../agent-docs/spec/domain/cutoff-and-calendar.md");
    const lifecycle = cutoff.split("Planning day states:")[1]?.split("\n")[0];
    expect(lifecycle?.match(/\b[A-Z_]{2,}\b/g)).toEqual(PLANNING_DAY_STATES);
    const model = read("../../../../agent-docs/spec/data/model.md");
    const row = model.split("`PlanningDay`")[1]?.split("\n")[0];
    expect(row?.match(/state \(([^)]+)\)/)?.[1]?.split(", ")).toEqual(PLANNING_DAY_STATES);
  });

  it("replays the initial enum and additive migrations into the same vocabulary", () => {
    const directory = new URL("../../prisma/migrations/", import.meta.url);
    const sql = readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((entry) => readFileSync(new URL(`${entry.name}/migration.sql`, directory), "utf8"))
      .join("\n");
    const initial = sql.match(/CREATE TYPE "PlanningDayState" AS ENUM \(([^)]+)\)/)?.[1];
    const values = [...(initial?.matchAll(/'([^']+)'/g) ?? [])].map((match) => match[1]);
    for (const match of sql.matchAll(/ALTER TYPE "PlanningDayState" ADD VALUE '([^']+)'/g)) values.push(match[1]);
    expect(values).toEqual(PLANNING_DAY_STATES);
  });
});
