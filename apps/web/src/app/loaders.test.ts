import { apiFixtures, apiRouteFixtures, apiVariantFixtures, type HumanRole } from "@nextdrop/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../i18n";
import { setFieldLanguage } from "../i18n/language";
import { setTransport } from "../lib/api";
import type { RawResponse } from "../lib/api/types";
import { queryClient } from "../lib/queryClient";
import { signIn } from "../lib/session";
import { entryLoader, loginLoader, roleLoader } from "./loaders";

const sessionOf = (role: HumanRole) => ({
  ...apiRouteFixtures.me.responses[200],
  user: apiVariantFixtures.sessionUser[role],
});

const signedOut: RawResponse = {
  status: 401,
  body: { ...apiFixtures.apiError, code: "UNAUTHENTICATED", message_key: "errors.unauthenticated" },
};

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

const target = (result: unknown) => (result instanceof Response ? result.headers.get("Location") : null);

beforeEach(async () => {
  queryClient.clear();
  setFieldLanguage("en");
  await i18n.changeLanguage("en");
});
afterEach(() => setTransport(null));

describe("role routes", () => {
  it("let a signed-in Driver move between screens with no signal, however long ago they signed in", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      await signedInAs("DRIVER");
      const calls = serve({});
      // Hours into the run, with no signal. Every navigation inside /driver/* runs the loader again.
      vi.setSystemTime(Date.now() + 6 * 60 * 60 * 1000);
      expect(await roleLoader("DRIVER")()).toBeNull();
      expect(await roleLoader("DRIVER")()).toBeNull();
      expect(calls).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ask GET /auth/me once, on the first load", async () => {
    const calls = serve({ me: { status: 200, body: sessionOf("STORE") } });
    expect(await roleLoader("STORE")()).toBeNull();
    expect(await roleLoader("STORE")()).toBeNull();
    expect(calls).toEqual(["me"]);
  });

  it("send a signed-out visitor to that role's login", async () => {
    serve({ me: signedOut });
    expect(target(await roleLoader("DRIVER")())).toBe("/login/driver");
  });

  it("send a signed-in user who opens another role's routes back to their own", async () => {
    await signedInAs("LOADER");
    expect(target(await roleLoader("STORE")())).toBe("/loader");
  });

  it("reject on a first load with no signal, so the error screen can offer a retry", async () => {
    serve({});
    await expect(roleLoader("DRIVER")()).rejects.toMatchObject({ kind: "network" });
  });
});

describe("login routes", () => {
  it("show the login screen on a first load with no signal", async () => {
    serve({});
    expect(await loginLoader({ params: { role: "driver" } })).toBeNull();
  });

  it("send a signed-in user to their own routes", async () => {
    await signedInAs("DISPATCHER");
    expect(target(await loginLoader({ params: { role: "store" } }))).toBe("/dispatch");
    expect(target(await entryLoader())).toBe("/dispatch");
  });

  it("send an unknown role to a real login screen", async () => {
    serve({ me: signedOut });
    expect(target(await loginLoader({ params: { role: "admin" } }))).toBe("/login/store");
  });
});

describe("language", () => {
  it("is the field language on Loader and Driver screens and English on Store and Dispatcher screens", async () => {
    serve({ me: signedOut });
    setFieldLanguage("ta");
    await loginLoader({ params: { role: "driver" } });
    expect(i18n.language).toBe("ta");
    // The Loader's Tamil must not follow the user to the Store login.
    await loginLoader({ params: { role: "store" } });
    expect(i18n.language).toBe("en");
    await loginLoader({ params: { role: "loader" } });
    expect(i18n.language).toBe("ta");
  });

  it("is set before a role shell renders", async () => {
    setFieldLanguage("si");
    await i18n.changeLanguage("en");
    await signedInAs("LOADER");
    await roleLoader("LOADER")();
    expect(i18n.language).toBe("si");
  });
});
