import { apiFixtures, apiRouteFixtures } from "@nextdrop/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clockOffsetMs } from "../clock";
import { callApi, setCsrfToken, setTransport, setUnauthenticatedHandler } from "./client";
import { ApiRequestError } from "./errors";
import type { RawResponse, TransportRequest } from "./types";

/** A transport that records what the client sent and answers with one canned response. */
function record(response: RawResponse) {
  const sent: TransportRequest[] = [];
  setTransport(async (request) => {
    sent.push(request);
    return response;
  });
  return sent;
}

afterEach(() => {
  setTransport(null);
  setCsrfToken(null);
  setUnauthenticatedHandler(null);
});

describe("callApi", () => {
  it("preserves the validated violation details and base error of a draft 422", async () => {
    const fixture = apiRouteFixtures.saveDraft;
    const body = fixture.responses[422];
    record({ status: 422, body });
    const error = await callApi("saveDraft", fixture.request).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 422, code: "VALIDATION_FAILED", validation: body.validation });
  });

  it("does not trust malformed extended validation errors", async () => {
    const fixture = apiRouteFixtures.saveDraft;
    record({ status: 422, body: { ...fixture.responses[422], validation: { ok: false, violations: [{}] } } });
    const error = await callApi("saveDraft", fixture.request).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 422, error: null, validation: null });
  });

  it("builds the path and the query from the route table", async () => {
    const fixture = apiRouteFixtures.storeOrder;
    const sent = record({ status: 200, body: fixture.responses[200] });
    await callApi("storeOrder", { params: fixture.request.params });
    expect(sent[0]?.method).toBe("GET");
    expect(sent[0]?.url).toBe(`/api/store/orders/${fixture.request.params.id}`);

    const outlets = record({ status: 200, body: apiRouteFixtures.outlets.responses[200] });
    await callApi("outlets", { query: { depot: "Peliyagoda" } });
    expect(outlets[0]?.url).toBe("/api/ref/outlets?depot=Peliyagoda");
  });

  it("sends the CSRF header on mutations only, using the session token once there is one", async () => {
    const session = apiRouteFixtures.login.responses[200];
    const login = record({ status: 200, body: session });
    await callApi("login", { body: apiFixtures.loginRequest });
    expect(login[0]?.headers["x-nextdrop-csrf"]).toBeTruthy();

    setCsrfToken("token-from-session");
    const logout = record({ status: 200, body: apiRouteFixtures.logout.responses[200] });
    await callApi("logout");
    expect(logout[0]?.headers["x-nextdrop-csrf"]).toBe("token-from-session");

    const me = record({ status: 200, body: session });
    await callApi("me");
    expect(me[0]?.headers["x-nextdrop-csrf"]).toBeUndefined();
  });

  it("learns the server clock from a response that carries serverTime", async () => {
    const serverTime = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
    record({ status: 200, body: { ...apiRouteFixtures.me.responses[200], serverTime } });
    await callApi("me");
    expect(Math.abs(clockOffsetMs() - 3 * 60 * 60 * 1000)).toBeLessThan(1000);
  });

  it("rejects with the server's error code on an error status", async () => {
    record({ status: 401, body: apiRouteFixtures.login.responses[401] });
    const error = await callApi("login", { body: apiFixtures.loginRequest }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ kind: "http", status: 401, code: "INVALID_CREDENTIALS" });
  });

  it("reports a lost session on a 401 from a session route, but not from login", async () => {
    const lost = vi.fn();
    setUnauthenticatedHandler(lost);
    record({ status: 401, body: apiRouteFixtures.login.responses[401] });
    await callApi("login", { body: apiFixtures.loginRequest }).catch(() => undefined);
    expect(lost).not.toHaveBeenCalled();
    await callApi("me").catch(() => undefined);
    expect(lost).toHaveBeenCalledOnce();
  });

  it("does not report a lost session when reauth answers 401: that is a wrong PIN", async () => {
    const lost = vi.fn();
    setUnauthenticatedHandler(lost);
    record({ status: 401, body: apiRouteFixtures.reauth.responses[401] });
    await callApi("reauth", { body: apiFixtures.reauthRequest }).catch(() => undefined);
    expect(lost).not.toHaveBeenCalled();
  });

  it("rejects an order with no idempotency-key before sending it", async () => {
    const sent = record({ status: 201, body: apiRouteFixtures.createOrder.responses[201] });
    const body = apiFixtures.createOrderRequest;
    await expect(callApi("createOrder", { body })).rejects.toMatchObject({ kind: "invalid" });
    expect(sent).toHaveLength(0);
    await callApi("createOrder", { body, headers: { "idempotency-key": "order-1" } });
    expect(sent[0]?.headers["idempotency-key"]).toBe("order-1");
  });

  it("rejects a request body that breaks the contract before sending it", async () => {
    const sent = record({ status: 200, body: apiRouteFixtures.login.responses[200] });
    const body = { role: "LOADER", loginId: "not-a-loader-id", pin: "1234", deviceId: "x" };
    const error = await callApi("login", { body: body as never }).catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: "invalid" });
    expect(sent).toHaveLength(0);
  });

  it("rejects a response that breaks the contract", async () => {
    record({ status: 200, body: { user: "nobody" } });
    await expect(callApi("me")).rejects.toMatchObject({ kind: "invalid", status: 200 });
  });

  it("reports a transport failure as a network error", async () => {
    setTransport(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(callApi("me")).rejects.toMatchObject({ kind: "network", status: null });
  });
});
