import type { HumanRole } from "@nextdrop/contracts";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Navigate } from "react-router";
import { useRoleLanguage } from "../i18n/language";
import { SessionContext, sessionQuery } from "../lib/session";
import { isFieldRole } from "../lib/fieldRoles";
import { FieldSync } from "../sync/FieldSync";
import { ResetBanner } from "./ResetBanner";
import { guardRole, ROLE_PATHS } from "./roles";

interface RoleShellProps {
  role: HumanRole;
  /** The role's routes. */
  children: ReactNode;
}

/**
 * The frame every role shell shares: the theme root, the language, the reset banner slot and the session.
 * The route loader has already checked the session; this also reacts when it is lost later (a 401 or sign-out).
 */
export function RoleShell({ role, children }: RoleShellProps) {
  const { data: session } = useQuery(sessionQuery);
  const language = useRoleLanguage(role);
  const redirect = guardRole(session?.user.role ?? null, role);
  if (!session || redirect) return <Navigate to={redirect ?? ROLE_PATHS[role].login} replace />;
  return (
    <SessionContext value={session}>
      <div data-theme={ROLE_PATHS[role].theme} lang={language} className="flex min-h-dvh flex-col">
        <ResetBanner />
        {isFieldRole(role) && <FieldSync compact={role === "DRIVER"} />}
        {children}
      </div>
    </SessionContext>
  );
}
