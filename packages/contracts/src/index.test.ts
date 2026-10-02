import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, schemaVersion } from "./index";

describe("@nextdrop/contracts", () => {
  it("accepts the current schema version and rejects a newer one", () => {
    expect(schemaVersion.parse(SCHEMA_VERSION)).toBe(SCHEMA_VERSION);
    expect(schemaVersion.safeParse(SCHEMA_VERSION + 1).success).toBe(false);
  });
});
