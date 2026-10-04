import { describe, expect, it, vi } from "vitest";
import { apiFixtures } from "@nextdrop/contracts";
import { PublishSession } from "./publish-session";
import { ApiRequestError } from "../../lib/api";

describe("D3 publication", () => {
  it("saves first and publishes the returned revision, not the original one", async () => {
    const session = new PublishSession();
    const save = vi.fn(async () => ({ ...apiFixtures.draft, revision: 7 }));
    const publish = vi.fn(async () => apiFixtures.publishResponse);
    await session.run(apiFixtures.draftData, { save, publish });
    expect(publish).toHaveBeenCalledWith(7);
    expect(save).toHaveBeenCalledBefore(publish);
  });
  it("retries an uncertain response at the same saved revision without saving again", async () => {
    const session = new PublishSession();
    const save = vi.fn(async () => ({ ...apiFixtures.draft, revision: 7 }));
    const publish = vi
      .fn()
      .mockRejectedValueOnce(new ApiRequestError("network", null, null, "lost response"))
      .mockResolvedValue(apiFixtures.publishResponse);
    await expect(session.run(apiFixtures.draftData, { save, publish })).rejects.toThrow("lost response");
    await session.run(apiFixtures.draftData, { save, publish });
    expect(save).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls).toEqual([[7], [7]]);
  });
  it("does not publish after a failed save and ignores concurrent clicks", async () => {
    const session = new PublishSession();
    let finish!: (value: null) => void;
    const save = vi.fn(
      () =>
        new Promise<null>((resolve) => {
          finish = resolve;
        }),
    );
    const publish = vi.fn(async () => apiFixtures.publishResponse);
    const first = session.run(apiFixtures.draftData, { save, publish });
    expect(await session.run(apiFixtures.draftData, { save, publish })).toBeNull();
    finish(null);
    expect(await first).toBeNull();
    expect(publish).not.toHaveBeenCalled();
  });
  it("keeps the idempotent revision when a background queue refresh follows an uncertain publish", async () => {
    const session = new PublishSession();
    const save = vi.fn(async () => ({ ...apiFixtures.draft, revision: 7 }));
    const publish = vi
      .fn()
      .mockRejectedValueOnce(new ApiRequestError("network", null, null, "lost response"))
      .mockResolvedValue(apiFixtures.publishResponse);
    await expect(session.run(apiFixtures.draftData, { save, publish })).rejects.toThrow();
    await session.run({ trips: [], deferrals: [], unassignedOrderIds: [] }, { save, publish });
    expect(save).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls).toEqual([[7], [7]]);
  });
  it("treats an invalid successful publish response as uncertain and retains its revision", async () => {
    const session = new PublishSession();
    const save = vi.fn(async () => ({ ...apiFixtures.draft, revision: 7 }));
    const publish = vi
      .fn()
      .mockRejectedValueOnce(new ApiRequestError("invalid", 200, null, "Invalid response"))
      .mockResolvedValue(apiFixtures.publishResponse);
    await expect(session.run(apiFixtures.draftData, { save, publish })).rejects.toThrow();
    await session.run({ trips: [], deferrals: [], unassignedOrderIds: [] }, { save, publish });
    expect(save).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls).toEqual([[7], [7]]);
  });
  it("propagates server validation and saves a changed review before retrying", async () => {
    const session = new PublishSession();
    const error = new ApiRequestError(
      "http",
      422,
      {
        code: "MISSING_DEFERRAL_REASON",
        message_key: "errors.missingDeferralReason",
        requestId: "test",
        params: { orders: 1 },
      },
      "Missing note",
      apiFixtures.validationResult,
    );
    const save = vi.fn(async () => ({ ...apiFixtures.draft, revision: 8 }));
    const publish = vi.fn().mockRejectedValueOnce(error).mockResolvedValue(apiFixtures.publishResponse);
    await expect(session.run(apiFixtures.draftData, { save, publish })).rejects.toBe(error);
    await session.run(
      { ...apiFixtures.draftData, deferrals: [{ orderId: apiFixtures.order.id, reasonCode: "OTHER", note: "Reason" }] },
      { save, publish },
    );
    expect(save).toHaveBeenCalledTimes(2);
  });
});
