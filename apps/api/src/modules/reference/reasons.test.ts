import { describe, expect, it } from "vitest";
import { reasonLists } from "./reasons";

describe("reason lists", () => {
  it("gives every reason an i18n key named after its list and code", () => {
    for (const [group, items] of Object.entries(reasonLists())) {
      for (const item of items) expect(item.message_key).toBe(`${group}.${item.code}`);
    }
  });
});
