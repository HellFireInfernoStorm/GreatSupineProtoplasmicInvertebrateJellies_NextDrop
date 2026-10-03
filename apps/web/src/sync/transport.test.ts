import { apiFixtures, apiVariantFixtures } from "@nextdrop/contracts";
import { afterEach, expect, it, vi } from "vitest";
import { setTransport } from "../lib/api";
import { queryClient } from "../lib/queryClient";
import { isReauthNeeded, signIn } from "../lib/session";
import { syncTransport } from "./transport";
import type { QueuedBlob } from "./database";

const photo = (): QueuedBlob => ({
  clientBlobId: apiFixtures.blobResponse.clientBlobId,
  userId: "driver-1",
  bytes: new Blob(["image"], { type: "image/jpeg" }),
  attempts: 0,
  state: "pending",
  lastError: null,
});
afterEach(() => {
  vi.unstubAllGlobals();
  setTransport(null);
  queryClient.clear();
});

it("a binary 401 pauses the field session even if the error body is not JSON", async () => {
  setTransport(async () => ({
    status: 200,
    body: { ...apiFixtures.sessionResponse, user: apiVariantFixtures.sessionUser.DRIVER },
  }));
  await signIn(apiVariantFixtures.loginRequest.DRIVER);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("Not signed in", { status: 401 })),
  );
  await expect(syncTransport.upload(photo())).rejects.toThrow();
  expect(isReauthNeeded()).toBe(true);
});

it("never acknowledges an upload using another blob's returned identity", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ ...apiFixtures.blobResponse, clientBlobId: "019932e4-2800-7000-8000-000000000999" }),
    ),
  );
  await expect(syncTransport.upload(photo())).rejects.toThrow("Uncorrelated blob acknowledgement");
});

it.each([413, 502])("preserves HTTP %s when the upload error is HTML", async (status) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("<html>proxy error</html>", { status })),
  );
  await expect(syncTransport.upload(photo())).rejects.toMatchObject({ kind: "http", status });
});

it("an empty 204 is not a valid upload confirmation", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 204 })),
  );
  await expect(syncTransport.upload(photo())).rejects.toMatchObject({ kind: "invalid", status: 204 });
});
