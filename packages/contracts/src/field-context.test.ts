import { expect, it } from "vitest";
import {
  fieldConflictContextFixture,
  fieldReassignedConflictContextFixture,
  fieldConflictSchema,
  fieldConflictsRequestSchema,
  fieldConflictsResponseSchema,
} from "./index";

it("provides a strict context fixture for cold recovery and explicit missing historical values", () => {
  expect(fieldConflictSchema.parse(fieldConflictContextFixture)).toEqual(fieldConflictContextFixture);
  expect(fieldConflictSchema.parse(fieldReassignedConflictContextFixture)).toEqual(
    fieldReassignedConflictContextFixture,
  );
  const missing = {
    ...fieldConflictContextFixture,
    context: {
      ...fieldConflictContextFixture.context,
      original: null,
      changes: [
        { ...fieldConflictContextFixture.context.changes[0], from: null, to: null, reasonCode: null, note: null },
      ],
    },
  };
  expect(fieldConflictSchema.parse(missing)).toEqual(missing);
  expect(fieldConflictSchema.safeParse({ ...missing, context: { ...missing.context, privatePlan: {} } }).success).toBe(
    false,
  );
});
it("keeps legacy lookup shapes while permitting opt-in context and reset correlation", () => {
  const clientEventIds = [fieldConflictContextFixture.clientEventId];
  expect(fieldConflictsRequestSchema.parse({ clientEventIds })).toEqual({ clientEventIds });
  expect(fieldConflictsRequestSchema.parse({ clientEventIds, includeContext: true }).includeContext).toBe(true);
  expect(
    fieldConflictsResponseSchema.parse({
      items: [fieldConflictContextFixture],
      serverTime: fieldConflictContextFixture.openedAt,
      feedHead: "9007199254740993",
      resetEpoch: 2,
    }).resetEpoch,
  ).toBe(2);
});
