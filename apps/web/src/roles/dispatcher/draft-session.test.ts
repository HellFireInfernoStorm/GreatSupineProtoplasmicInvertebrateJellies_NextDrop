import { describe, expect, it } from "vitest";
import { DraftSession } from "./draft-session";
import { emptyDraft, type Draft } from "./planning";
import { ApiRequestError } from "../../lib/api";

const data = emptyDraft([]);
const saved = (revision: number): Draft => ({ revision, baseVersion: null, updatedAt: "2026-10-03T00:00:00Z", data });
describe("draft persistence", () => {
  it("serializes proposal writes with edits and installs only the returned revision", async () => {
    const session = new DraftSession(saved(2), []);
    let seen = -1;
    await session.propose(async (revision) => {
      seen = revision;
      return saved(3);
    });
    expect(seen).toBe(2);
    expect(session.getSnapshot()).toMatchObject({ draft: { revision: 3 }, busy: false });
  });
  it("validates before saving and uses revision zero for the first write", async () => {
    const session = new DraftSession(null, []);
    const calls: unknown[] = [];
    await session.persist(data, {
      validate: async (candidate) => {
        calls.push(candidate);
        return { ok: true, violations: [] };
      },
      save: async (candidate, revision) => {
        calls.push(revision);
        return saved(revision + 1);
      },
    });
    expect(calls).toEqual([data, 0]);
    expect(session.getSnapshot().draft?.revision).toBe(1);
  });
  it("retains the candidate and old revision on 409 until explicit reload", async () => {
    const session = new DraftSession(saved(3), []);
    const candidate = emptyDraft(["new-order"]);
    await session.persist(candidate, {
      validate: async () => ({ ok: true, violations: [] }),
      save: async () => {
        throw new ApiRequestError(
          "http",
          409,
          {
            code: "REVISION_CONFLICT",
            message_key: "errors.revisionConflict",
            params: { revision: 4 },
            requestId: "test",
          },
          "Conflict",
        );
      },
    });
    expect(session.getSnapshot()).toMatchObject({ draft: { revision: 3 }, candidate, busy: false });
    session.replace(saved(4), []);
    expect(session.getSnapshot()).toMatchObject({ draft: { revision: 4 }, candidate: null, error: null });
  });
  it("blocks server hard failures without calling save", async () => {
    const session = new DraftSession(null, []);
    let saves = 0;
    await session.persist(data, {
      validate: async () => ({ ok: false, violations: [] }),
      save: async () => {
        saves++;
        return saved(1);
      },
    });
    expect(saves).toBe(0);
    expect(session.getSnapshot().validation?.ok).toBe(false);
  });
  it("refuses concurrent writes and permits warnings", async () => {
    const session = new DraftSession(saved(2), []);
    let resolve!: () => void;
    const pending = new Promise<void>((r) => {
      resolve = r;
    });
    let saves = 0;
    const ports = {
      validate: async () => {
        await pending;
        return { ok: true, violations: [] };
      },
      save: async () => {
        saves++;
        return saved(3);
      },
    };
    const first = session.persist(data, ports);
    expect(await session.persist(data, ports)).toBe(false);
    resolve();
    await first;
    expect(saves).toBe(1);
  });
});
