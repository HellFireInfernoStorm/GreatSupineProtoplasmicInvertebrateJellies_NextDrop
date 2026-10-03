import { apiFixtures, apiRouteFixtures, apiVariantFixtures, type HumanRole } from "@nextdrop/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { callApi, setTransport } from "./api";
import type { RawResponse } from "./api/types";
import { queryClient } from "./queryClient";
import { currentSession, isReauthNeeded, reauth, signIn, signOut } from "./session";

const sessionOf = (role: HumanRole, csrfToken = "token-1") => ({
  ...apiRouteFixtures.me.responses[200],
  user: apiVariantFixtures.sessionUser[role],
  csrfToken,
});

const unauthenticated: RawResponse = {
  status: 401,
  body: { ...apiFixtures.apiError, code: "UNAUTHENTICATED", message_key: "errors.unauthenticated" },
};

/** Answer each route by name; an unlisted route fails the way a dead network does. */
function serve(answers: Partial<Record<string, RawResponse>>) {
  const calls: string[] = [];
  setTransport(async (request) => {
    calls.push(request.name);
    const answer = answers[request.name];
    if (!answer) throw new TypeError("Failed to fetch");
    return answer;
  });
  return calls;
}

async function signedInAs(role: HumanRole) {
  serve({ login: { status: 200, body: sessionOf(role) } });
  await signIn(apiVariantFixtures.loginRequest[role]);
}

beforeEach(() => queryClient.clear());
afterEach(() => setTransport(null));

describe("a 401 from the server", () => {
  it("signs a Store manager out and drops what was cached for them", async () => {
    await signedInAs("STORE");
    queryClient.setQueryData(["store", "orders"], ["an order"]);
    serve({ storeDeliveries: unauthenticated });
    await callApi("storeDeliveries", { query: apiFixtures.dateQuery }).catch(() => undefined);
    expect(currentSession()).toBeNull();
    expect(queryClient.getQueryData(["store", "orders"])).toBeUndefined();
    expect(isReauthNeeded()).toBe(false);
  });

  it("keeps a Driver signed in and asks for the PIN instead", async () => {
    await signedInAs("DRIVER");
    queryClient.setQueryData(["driver", "run"], ["a stop"]);
    serve({ heartbeat: unauthenticated });
    await callApi("heartbeat", { body: apiFixtures.heartbeatRequest }).catch(() => undefined);
    expect(currentSession()?.user.role).toBe("DRIVER");
    expect(queryClient.getQueryData(["driver", "run"])).toEqual(["a stop"]);
    expect(isReauthNeeded()).toBe(true);
  });

  it("leaves the session alone when the 401 is a wrong PIN on reauth", async () => {
    await signedInAs("LOADER");
    serve({ heartbeat: unauthenticated, reauth: { status: 401, body: apiRouteFixtures.reauth.responses[401] } });
    await callApi("heartbeat", { body: apiFixtures.heartbeatRequest }).catch(() => undefined);
    await expect(reauth("0000")).rejects.toMatchObject({ status: 401 });
    expect(currentSession()?.user.role).toBe("LOADER");
    expect(isReauthNeeded()).toBe(true);
  });
});

describe("reauth", () => {
  it("renews a field session with the PIN and clears the prompt", async () => {
    await signedInAs("LOADER");
    serve({ heartbeat: unauthenticated, reauth: { status: 200, body: sessionOf("LOADER", "token-2") } });
    await callApi("heartbeat", { body: apiFixtures.heartbeatRequest }).catch(() => undefined);
    const renewed = await reauth("1234");
    expect(renewed.csrfToken).toBe("token-2");
    expect(currentSession()?.csrfToken).toBe("token-2");
    expect(isReauthNeeded()).toBe(false);
  });

  it("keeps the session through a lockout, to try again later", async () => {
    await signedInAs("DRIVER");
    serve({ heartbeat: unauthenticated, reauth: { status: 429, body: apiRouteFixtures.reauth.responses[429] } });
    await callApi("heartbeat", { body: apiFixtures.heartbeatRequest }).catch(() => undefined);
    await expect(reauth("1234")).rejects.toMatchObject({ status: 429 });
    expect(currentSession()?.user.role).toBe("DRIVER");
    expect(isReauthNeeded()).toBe(true);
  });

  // The server answers UNAUTHENTICATED when the reauth window has passed or the device does not match.
  it("sends the user to the full login when the server has no session left to renew", async () => {
    await signedInAs("DRIVER");
    queryClient.setQueryData(["driver", "run"], ["a stop"]);
    serve({ heartbeat: unauthenticated, reauth: unauthenticated });
    await callApi("heartbeat", { body: apiFixtures.heartbeatRequest }).catch(() => undefined);
    await expect(reauth("1234")).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
    expect(currentSession()).toBeNull();
    expect(isReauthNeeded()).toBe(false);
    expect(queryClient.getQueryData(["driver", "run"])).toBeUndefined();
  });

  it("is refused for a Store or Dispatcher session", async () => {
    await signedInAs("DISPATCHER");
    await expect(reauth("1234")).rejects.toThrow();
  });
});

describe("sign-out", () => {
  it("forgets the session and its cached data once the server confirms", async () => {
    await signedInAs("STORE");
    queryClient.setQueryData(["store", "orders"], ["an order"]);
    serve({ logout: { status: 200, body: apiRouteFixtures.logout.responses[200] } });
    await signOut();
    expect(currentSession()).toBeNull();
    expect(queryClient.getQueryData(["store", "orders"])).toBeUndefined();
  });

  it("stays signed in and rejects when the server cannot be reached", async () => {
    await signedInAs("LOADER");
    serve({});
    await expect(signOut()).rejects.toMatchObject({ kind: "network" });
    expect(currentSession()?.user.role).toBe("LOADER");
  });

  it("counts a 401 as signed out: the server had already dropped the session", async () => {
    await signedInAs("DRIVER");
    serve({ logout: unauthenticated });
    await signOut();
    expect(currentSession()).toBeNull();
    expect(isReauthNeeded()).toBe(false);
  });
});

describe("sign-in", () => {
  it("drops data cached for whoever used the device before", async () => {
    queryClient.setQueryData(["driver", "run"], ["someone else's stop"]);
    await signedInAs("DRIVER");
    expect(queryClient.getQueryData(["driver", "run"])).toBeUndefined();
    expect(currentSession()?.user.role).toBe("DRIVER");
  });
});

describe("field session persistence across reload", () => {
  it("restores the Driver shell offline and asks for PIN without losing queued work", async () => {
    await signedInAs("DRIVER");
    const { offlineDb } = await import("../sync/database");
    await offlineDb.set("testWork", "kept");
    queryClient.clear();
    serve({});
    const { sessionQuery } = await import("./session");
    const session = await queryClient.ensureQueryData(sessionQuery);
    expect(session?.user.role).toBe("DRIVER");
    expect(isReauthNeeded()).toBe(true);
    expect(await offlineDb.value("testWork")).toBe("kept");
  });

  it("restores a saved Loader on a cold /me 401 rather than showing full login", async () => {
    await signedInAs("LOADER");
    queryClient.clear();
    serve({ me: unauthenticated });
    const { sessionQuery } = await import("./session");
    expect((await queryClient.ensureQueryData(sessionQuery))?.user.role).toBe("LOADER");
    expect(isReauthNeeded()).toBe(true);
  });

  it("does not restore online-role sessions offline", async () => {
    await signedInAs("STORE");
    queryClient.clear();
    serve({});
    const { sessionQuery } = await import("./session");
    await expect(queryClient.ensureQueryData(sessionQuery)).rejects.toMatchObject({ kind: "network" });
  });

  it("nonrenewable auth removes only the saved session, preserving the outbox", async () => {
    await signedInAs("DRIVER");
    const { fieldRepository } = await import("../sync/repository");
    const entry = await fieldRepository.enqueue({
      ...apiFixtures.clientEvent,
      actor: { userId: currentSession()!.user.id, role: "DRIVER" },
    });
    serve({ reauth: unauthenticated });
    await expect(reauth("1234")).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(await fieldRepository.db.value("localSession")).toBeUndefined();
    expect((await fieldRepository.db.outbox.get(entry.clientEventId))?.state).toBe("pending");
  });
});
