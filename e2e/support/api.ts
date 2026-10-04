import { request, type APIRequestContext } from "@playwright/test";
import { ACCOUNTS, DEMO_PASSWORD, DEPOTS } from "./accounts";

const CSRF_HEADER = "x-nextdrop-csrf";
/** What a mutation sends before there is a session (the login itself). */
const CSRF_BEFORE_SESSION = "1";

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
    const response = await context.post("/api/auth/login", {
      headers: { [CSRF_HEADER]: CSRF_BEFORE_SESSION },
      data: { role: "DISPATCHER", email: ACCOUNTS.dispatcher.login, password: DEMO_PASSWORD, depot },
    });
    if (!response.ok()) {
      throw new Error(`Dispatcher sign-in failed at ${baseURL}: ${response.status()} ${await response.text()}`);
    }
    const session = (await response.json()) as { csrfToken: string };
    return new ApiSession(context, session.csrfToken);
  }

  async get<T>(path: string): Promise<T> {
    return this.read<T>("GET", path, await this.context.get(path));
  }

  async post<T>(path: string, data: unknown = undefined): Promise<T> {
    const response = await this.context.post(path, { headers: { [CSRF_HEADER]: this.csrfToken }, data });
    return this.read<T>("POST", path, response);
  }

  async put<T>(path: string, data: unknown): Promise<T> {
    const response = await this.context.put(path, { headers: { [CSRF_HEADER]: this.csrfToken }, data });
    return this.read<T>("PUT", path, response);
  }

  async dispose(): Promise<void> {
    await this.context.dispose();
  }

  private async read<T>(method: string, path: string, response: Awaited<ReturnType<APIRequestContext["get"]>>) {
    if (!response.ok()) throw new Error(`${method} ${path} answered ${response.status()}: ${await response.text()}`);
    return (await response.json()) as T;
  }
}
