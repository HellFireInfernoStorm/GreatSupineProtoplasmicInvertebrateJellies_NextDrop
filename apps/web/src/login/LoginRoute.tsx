import { useEffect } from "react";
import { useParams } from "react-router";
import { rememberLoginRole, roleFromSlug } from "../app/roles";
import { DispatcherLogin } from "./DispatcherLogin";
import { DriverLogin } from "./DriverLogin";
import { LoaderLogin } from "./LoaderLogin";
import { StoreLogin } from "./StoreLogin";

const SCREENS = { STORE: StoreLogin, DISPATCHER: DispatcherLogin, LOADER: LoaderLogin, DRIVER: DriverLogin };

/** `/login/:role`. The loader has already redirected unknown roles and signed-in users. */
export function LoginRoute() {
  const role = roleFromSlug(useParams().role) ?? "STORE";
  useEffect(() => rememberLoginRole(role), [role]);
  const Screen = SCREENS[role];
  return <Screen />;
}
