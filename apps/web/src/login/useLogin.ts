import type { LoginRequest } from "@nextdrop/contracts";
import { useCallback, useState } from "react";
import { useNavigate } from "react-router";
import { ROLE_PATHS } from "../app/roles";
import { ApiRequestError } from "../lib/api";
import { signIn } from "../lib/session";

/** Why a sign-in failed, as the login screens word it. */
export type LoginFailure = "invalid" | "locked" | "forbidden" | "network" | "unknown";

export function loginFailureOf(error: unknown): LoginFailure {
  if (error instanceof ApiRequestError) {
    if (error.kind === "network") return "network";
    if (error.status === 401) return "invalid";
    if (error.status === 429) return "locked";
    if (error.status === 403) return "forbidden";
  }
  return "unknown";
}

/** Sign in and open the role's first screen. Resolves to false when the sign-in failed. */
export function useLogin() {
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<LoginFailure | null>(null);

  const submit = useCallback(
    async (request: LoginRequest): Promise<boolean> => {
      setPending(true);
      setFailure(null);
      try {
        const session = await signIn(request);
        await navigate(ROLE_PATHS[session.user.role].home, { replace: true });
        return true;
      } catch (error) {
        setFailure(loginFailureOf(error));
        return false;
      } finally {
        setPending(false);
      }
    },
    [navigate],
  );

  const clearFailure = useCallback(() => setFailure(null), []);
  return { pending, failure, submit, clearFailure };
}
