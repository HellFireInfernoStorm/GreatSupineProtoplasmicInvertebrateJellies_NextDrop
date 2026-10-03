import type { ApiDto, LoginRequest } from "@nextdrop/contracts";
import { queryOptions } from "@tanstack/react-query";
import { createContext, use } from "react";
import { ApiRequestError, callApi, setCsrfToken, setUnauthenticatedHandler } from "./api";
import { queryClient } from "./queryClient";

// The signed-in session, held in the query cache under one key. Route guards read it through sessionQuery
// (GET /auth/me), and login and logout write it, so the whole app agrees on who is signed in.

export type Session = ApiDto<"sessionResponse">;

const SESSION_KEY = ["auth", "me"] as const;

function remember(session: Session | null): Session | null {
  setCsrfToken(session?.csrfToken ?? null);
  queryClient.setQueryData(SESSION_KEY, session);
  return session;
}

/** The current session, or null when nobody is signed in. A network failure rejects instead of signing out. */
async function fetchSession(): Promise<Session | null> {
  try {
    const session = await callApi("me");
    setCsrfToken(session.csrfToken);
    return session;
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 401) return null;
    throw error;
  }
}

export const sessionQuery = queryOptions({
  queryKey: SESSION_KEY,
  queryFn: fetchSession,
  staleTime: 60_000,
  retry: false,
});

export async function signIn(request: LoginRequest): Promise<Session> {
  const session = await callApi("login", { body: request });
  remember(session);
  return session;
}

export async function signOut(): Promise<void> {
  try {
    await callApi("logout");
  } finally {
    remember(null);
  }
}

/** Provided by the role shell, which renders its screens only while a session of its role exists. */
export const SessionContext = createContext<Session | null>(null);

/** The session inside a role shell. */
export function useSession(): Session {
  const session = use(SessionContext);
  if (!session) throw new Error("useSession was used outside a role shell");
  return session;
}

// A 401 from any session route means the session is gone: forget it so the guards send the user to login.
setUnauthenticatedHandler(() => {
  setCsrfToken(null);
  queryClient.setQueryData(SESSION_KEY, null);
});
