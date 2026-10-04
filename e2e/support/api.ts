import { request, type APIRequestContext, type APIResponse } from "@playwright/test";
import { ACCOUNTS, DEMO_PASSWORD, DEPOTS } from "./accounts";

const CSRF_HEADER = "x-nextdrop-csrf";
/** What a mutation sends before there is a session (the login itself). */
const CSRF_BEFORE_SESSION = "1";
/** The longest a rate limit is waited out. The limits are per minute: 30 logins, 10 demo resets, 10 clock moves. */
const MAX_RATE_LIMIT_WAIT_S = 60;

/**
 * Send a request and, if the server answers 429, wait as long as it asks and send it once more. A failed run
 * restarts its worker, which signs in and resets the demo again; without the wait those calls fail as 429 and bury
 * the first, real failure.
 */
async function sendPatiently(send: () => Promise<APIResponse>): Promise<APIResponse> {
  const response = await send();
  if (response.status() !== 429) return response;
  const seconds = Math.min(Number(response.headers()["retry-after"]) || 1, MAX_RATE_LIMIT_WAIT_S);
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  return send();
}

/**
 * A signed-in API session outside the browser, for what a judge does through the demo panel and for test setup.
 * The walkthrough's own steps go through the screens, never through this.
 */
export class ApiSession {
  private constructor(
    private readonly context: APIRequestContext,
    private readonly csrfToken: string,
  ) {}

  /** Nimal, the dispatcher: the only role allowed to reset the demo and move its clock (§15.2). */
  static async dispatcher(baseURL: string, depot: string = DEPOTS.peliyagoda): Promise<ApiSession> {
    const context = await request.newContext({ baseURL });
    const response = await sendPatiently(() =>
      context.post("/api/auth/login", {
        headers: { [CSRF_HEADER]: CSRF_BEFORE_SESSION },
        data: { role: "DISPATCHER", email: ACCOUNTS.dispatcher.login, password: DEMO_PASSWORD, depot },
      }),
    );
    if (!response.ok()) {
      throw new Error(`Dispatcher sign-in failed at ${baseURL}: ${response.status()} ${await response.text()}`);
    }
    const session = (await response.json()) as { csrfToken: string };
    return new ApiSession(context, session.csrfToken);
  }

  async get<T>(path: string): Promise<T> {
    return this.read<T>("GET", path, await sendPatiently(() => this.context.get(path)));
  }

  async post<T>(path: string, data: unknown = undefined): Promise<T> {
    const headers = { [CSRF_HEADER]: this.csrfToken };
    return this.read<T>("POST", path, await sendPatiently(() => this.context.post(path, { headers, data })));
  }

  async put<T>(path: string, data: unknown): Promise<T> {
    const headers = { [CSRF_HEADER]: this.csrfToken };
    return this.read<T>("PUT", path, await sendPatiently(() => this.context.put(path, { headers, data })));
  }

  async dispose(): Promise<void> {
    await this.context.dispose();
  }

  private async read<T>(method: string, path: string, response: APIResponse) {
    if (!response.ok()) throw new Error(`${method} ${path} answered ${response.status()}: ${await response.text()}`);
    return (await response.json()) as T;
  }
}
