import { sessionResponseSchema, type ApiDto, type LoginRequest } from "@nextdrop/contracts";
import { queryOptions, type QueryKey } from "@tanstack/react-query";
import { createContext, use } from "react";
import { create } from "zustand";
import { ApiRequestError, callApi, setCsrfToken, setUnauthenticatedHandler } from "./api";
import { getDeviceId, initializeDevice } from "./device";
import { isFieldRole } from "./fieldRoles";
import { queryClient } from "./queryClient";
import { optionalMeta, persistOptional } from "./offline-meta";
import { offlineDb } from "../sync/database";
import { restoreClockOffset } from "./clock";
import { setDemoNotice, type DemoNotice } from "./demo";

// The signed-in session, held in the query cache under one key. GET /auth/me is asked once, when the app loads.
// After that the session changes only through sign-in, sign-out, reauth, or a 401 from the server, so a role shell
// keeps working with no signal (spec/sync/offline-client.md, Local session).

export type Session = ApiDto<"sessionResponse">;

const SESSION_KEY = ["auth", "me"] as const;

const isSessionKey = (key: QueryKey) => key[0] === SESSION_KEY[0] && key[1] === SESSION_KEY[1];

const useReauthStore = create<{ needed: boolean }>(() => ({ needed: false }));

/** The session the app knows about right now, or null. */
export function currentSession(): Session | null {
  return queryClient.getQueryData<Session | null>(SESSION_KEY) ?? null;
}

function remember(session: Session | null): Session | null {
  setCsrfToken(session?.csrfToken ?? null);
  queryClient.setQueryData(SESSION_KEY, session);
  useReauthStore.setState({ needed: false });
  return session;
}

/** Drop everything cached for the previous session, so the next user of a shared device starts clean. */
function dropCachedData(): void {
  queryClient.removeQueries({ predicate: (query) => !isSessionKey(query.queryKey) });
}

/** The current session, or null when nobody is signed in. A network failure rejects instead of signing out. */
async function persistSession(session: Session | null): Promise<void> {
  await persistOptional(() =>
    offlineDb.transaction("rw", offlineDb.meta, async () => {
      if (session && isFieldRole(session.user.role)) await offlineDb.set("localSession", session);
      else {
        await offlineDb.meta.delete("localSession");
        await offlineDb.meta.delete("simulateOffline");
      }
    }),
  );
}

async function fetchSession(): Promise<Session | null> {
  await initializeDevice();
  const offset = await optionalMeta<number>("serverOffset");
  if (offset !== undefined) restoreClockOffset(offset);
  const notice = await optionalMeta<DemoNotice>("resetNotice");
  if (notice) setDemoNotice(notice);
  const parsed = sessionResponseSchema.safeParse(await optionalMeta("localSession"));
  const saved = parsed.success && isFieldRole(parsed.data.user.role) ? parsed.data : null;
  if (saved) remember(saved);
  try {
    if (saved && (await optionalMeta("simulateOffline")))
      throw new ApiRequestError("network", null, null, "Simulated offline");
    const session = await callApi("me");
    await persistSession(session);
    remember(session);
    return session;
  } catch (error) {
    if (saved && error instanceof ApiRequestError && (error.status === 401 || error.kind === "network")) {
      useReauthStore.setState({ needed: error.status === 401 });
      return saved;
    }
    if (error instanceof ApiRequestError && error.status === 401) return null;
    throw error;
  }
}

export const sessionQuery = queryOptions({
  queryKey: SESSION_KEY,
  queryFn: fetchSession,
  // Never refetched behind the app's back: a refetch with no signal must not take the shell away.
  staleTime: Infinity,
  gcTime: Infinity,
  retry: false,
  refetchOnMount: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
});

export async function signIn(request: LoginRequest): Promise<Session> {
  await initializeDevice();
  const session = await callApi("login", { body: request });
  await persistSession(session);
  dropCachedData();
  remember(session);
  return session;
}

/**
 * Sign out on the server, then forget the session and everything cached for it. Rejects, with the session kept,
 * when the server cannot be reached: its cookie would still be valid, so the device is not signed out yet.
 */
export async function signOut(): Promise<void> {
  try {
    await callApi("logout");
  } catch (error) {
    // 401: the server has already dropped the session, which is what sign-out wants.
    if (!(error instanceof ApiRequestError && error.status === 401)) throw error;
  }
  await persistSession(null);
  dropCachedData();
  remember(null);
}

/**
 * True while a Loader or Driver has to enter the PIN again because the server answered 401. The session and the
 * outbox are kept (spec/sync/offline-client.md): the offline core (#40) pauses sync and asks for the PIN.
 */
export function useReauthNeeded(): boolean {
  return useReauthStore((s) => s.needed);
}

/** The same flag outside React, for the sync controller. */
export function isReauthNeeded(): boolean {
  return useReauthStore.getState().needed;
}

/**
 * Renew a Loader or Driver session with the PIN. It always rejects on failure, and what happens to the session
 * depends on why:
 * - a wrong PIN (`INVALID_CREDENTIALS`), a lockout (429) or no signal: the session stays, to try again;
 * - `UNAUTHENTICATED`: the server holds no session this device can renew (the reauth window has passed, or the
 *   device or role does not match). No PIN can work, so the session is dropped and the shell goes to the full login.
 */
export async function reauth(pin: string): Promise<Session> {
  const role = currentSession()?.user.role;
  if (!role || !isFieldRole(role)) throw new Error("reauth needs a Loader or Driver session");
  try {
    const session = await callApi("reauth", { body: { role, pin, deviceId: getDeviceId() } });
    await persistSession(session);
    remember(session);
    return session;
  } catch (error) {
    if (error instanceof ApiRequestError && error.code === "UNAUTHENTICATED") {
      await persistSession(null);
      dropCachedData();
      remember(null);
    }
    throw error;
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

// A 401 from a session route means the server no longer accepts the session. Store and Dispatcher are online
// roles: forget the session, and the shell sends them to login. Loader and Driver keep theirs and are asked for
// the PIN, so unsent work is not lost.
setUnauthenticatedHandler(() => {
  const role = currentSession()?.user.role;
  if (!role) return;
  if (isFieldRole(role)) {
    useReauthStore.setState({ needed: true });
  } else {
    dropCachedData();
    remember(null);
    void persistSession(null);
  }
});
