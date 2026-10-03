import type { HumanRole } from "@nextdrop/contracts";
import { redirect, type LoaderFunctionArgs } from "react-router";
import { applyRoleLanguage } from "../i18n/language";
import { ApiRequestError } from "../lib/api";
import { queryClient } from "../lib/queryClient";
import { sessionQuery } from "../lib/session";
import { guardLogin, guardRole, lastLoginRole, roleFromSlug, ROLE_PATHS } from "./roles";

// Route loaders: the guards, and the role's language set before its screen renders.
//
// The session is asked from the server once, on the first load. Afterwards the loaders use the session the app
// already holds, so moving between screens never waits on GET /auth/me and never fails with no signal.

async function sessionRole(): Promise<HumanRole | null> {
  const session = await queryClient.ensureQueryData(sessionQuery);
  return session?.user.role ?? null;
}

/** For the login screens: with no signal on a first load, show the login screen instead of an error. */
async function sessionRoleOrSignedOut(): Promise<HumanRole | null> {
  try {
    return await sessionRole();
  } catch (error) {
    if (error instanceof ApiRequestError && error.kind === "network") return null;
    throw error;
  }
}

/** `/`, `/login` and unknown paths: the signed-in role's home, or the login screen this device used last. */
export async function entryLoader() {
  const role = await sessionRoleOrSignedOut();
  return redirect(role ? ROLE_PATHS[role].home : ROLE_PATHS[lastLoginRole()].login);
}

/** `/login/:role`. */
export async function loginLoader({ params }: Pick<LoaderFunctionArgs, "params">) {
  const signedIn = guardLogin(await sessionRoleOrSignedOut());
  if (signedIn) return redirect(signedIn);
  const role = roleFromSlug(params.role);
  if (!role) return redirect(ROLE_PATHS[lastLoginRole()].login);
  await applyRoleLanguage(role);
  return null;
}

/**
 * A role's routes. With no signal and no session known yet (a first load), this rejects and the route error
 * screen offers a retry: the offline core (#40) keeps the session on the device so that case can start too.
 */
export function roleLoader(role: HumanRole) {
  return async () => {
    const target = guardRole(await sessionRole(), role);
    if (target) return redirect(target);
    await applyRoleLanguage(role);
    return null;
  };
}
