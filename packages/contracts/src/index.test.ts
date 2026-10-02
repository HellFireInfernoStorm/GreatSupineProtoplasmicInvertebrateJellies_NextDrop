import { describe, expect, it } from "vitest";
import { ERROR_CODES, FEED_KINDS, SCHEMA_VERSION, SYNC_RESULT_STATUSES, schemaVersion } from "./index";

describe("@nextdrop/contracts", () => {
  it("accepts the current schema version and rejects a newer one", () => {
    expect(schemaVersion.parse(SCHEMA_VERSION)).toBe(SCHEMA_VERSION);
    expect(schemaVersion.safeParse(SCHEMA_VERSION + 1).success).toBe(false);
  });

  it("exports sync, feed and error vocabularies", () => {
    expect(SYNC_RESULT_STATUSES).toContain("ACCEPTED");
    expect(FEED_KINDS).toContain("plan_published");
    expect(ERROR_CODES).toContain("SCHEMA_INVALID");
  });
});
