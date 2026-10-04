import type { ReduceOutcome } from "@nextdrop/rules";
import { describe, expect, it } from "vitest";
import { classifyFact, type ClassifyInput } from "./classify";

const T1 = { tripId: "T1", vehicleId: "VEH039" };
const T2 = { tripId: "T2", vehicleId: "VEH040" };
const applied: ReduceOutcome = { kind: "APPLIED", from: "OUT_FOR_DELIVERY", to: "DELIVERED", forced: false };
const illegal = {
  kind: "ILLEGAL_TRANSITION",
  from: "LOADED",
  to: "DELIVERED",
  reason: "NOT_IN_TABLE",
} as ReduceOutcome;

const input = (over: Partial<ClassifyInput>): ClassifyInput => ({
  type: "STOP_OUTCOME",
  plan: null,
  current: T1,
  appliedSameTypeDevices: [],
  deviceId: "dev-a",
  outcome: applied,
  ...over,
});

describe("classifyFact (spec/sync/recovery-and-conflicts.md)", () => {
  it("applies when the device saw the current version (no plan context)", () => {
    expect(classifyFact(input({}))).toEqual({ kind: "APPLY" });
  });

  it("applies when no change in (v, V] moved the stop", () => {
    const plan = { slotAtV: T1, changes: ["RESEQUENCED", "ETA_CHANGED"] };
    expect(classifyFact(input({ plan }))).toEqual({ kind: "APPLY" });
  });

  it("holds a delivery fact on a stop deferred since v as FACT_ON_CANCELLED_STOP", () => {
    for (const type of ["STOP_ARRIVED", "STOP_OUTCOME", "POD_CAPTURED"] as const) {
      const plan = { slotAtV: T1, changes: ["DEFERRED"] };
      expect(classifyFact(input({ type, plan, current: null }))).toEqual({
        kind: "HOLD",
        conflict: "FACT_ON_CANCELLED_STOP",
      });
    }
  });

  it("holds a delivery fact on a stop moved to another vehicle or trip as FACT_ON_REASSIGNED_STOP", () => {
    for (const change of ["MOVED_VEHICLE", "MOVED_TRIP"]) {
      const plan = { slotAtV: T1, changes: [change] };
      expect(classifyFact(input({ plan, current: T2 }))).toEqual({ kind: "HOLD", conflict: "FACT_ON_REASSIGNED_STOP" });
    }
  });

  it("applies a fact on a stop moved away and back again", () => {
    const plan = { slotAtV: T1, changes: ["MOVED_VEHICLE", "MOVED_VEHICLE"] };
    expect(classifyFact(input({ plan, current: T1 }))).toEqual({ kind: "APPLY" });
  });

  it("holds LOAD_CONFIRMED for an order the plan no longer holds as LOAD_AGAINST_CHANGED_PLAN", () => {
    const loaded = { kind: "APPLIED", from: "PLANNED", to: "LOADED", forced: false } as ReduceOutcome;
    for (const current of [null, T2]) {
      const plan = { slotAtV: T1, changes: [current ? "MOVED_VEHICLE" : "DEFERRED"] };
      expect(classifyFact(input({ type: "LOAD_CONFIRMED", plan, current, outcome: loaded }))).toEqual({
        kind: "HOLD",
        conflict: "LOAD_AGAINST_CHANGED_PLAN",
      });
    }
  });

  it("applies non-fact events on changed stops", () => {
    const plan = { slotAtV: T1, changes: ["DEFERRED"] };
    const informational = { kind: "NO_EFFECT", reason: "INFORMATIONAL" } as ReduceOutcome;
    expect(classifyFact(input({ type: "PLAN_ACKNOWLEDGED", plan, current: null, outcome: informational }))).toEqual({
      kind: "APPLY",
    });
  });

  it("holds an outcome or proof when another device already reported one as DUPLICATE_DELIVERY_FACT", () => {
    for (const type of ["STOP_OUTCOME", "POD_CAPTURED"] as const) {
      expect(classifyFact(input({ type, appliedSameTypeDevices: ["dev-b"] }))).toEqual({
        kind: "HOLD",
        conflict: "DUPLICATE_DELIVERY_FACT",
      });
    }
    // The same device again is not a duplicate report.
    expect(classifyFact(input({ type: "POD_CAPTURED", appliedSameTypeDevices: ["dev-a"] }))).toEqual({ kind: "APPLY" });
  });

  it("holds an illegal field fact as ILLEGAL_TRANSITION, but rejects a device contradicting its own outcome", () => {
    expect(classifyFact(input({ outcome: illegal }))).toEqual({ kind: "HOLD", conflict: "ILLEGAL_TRANSITION" });
    expect(classifyFact(input({ outcome: illegal, appliedSameTypeDevices: ["dev-a"] }))).toEqual({ kind: "REJECT" });
    expect(classifyFact(input({ type: "LOAD_SHORT", outcome: illegal }))).toEqual({ kind: "REJECT" });
  });
});
