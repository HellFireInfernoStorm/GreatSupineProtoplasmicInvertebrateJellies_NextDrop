import { loginRequestSchema } from "@nextdrop/contracts";
import { useCallback, useEffect, useState } from "react";
import { getDeviceId } from "../lib/device";
import { readStored, writeStored } from "../lib/storage";
import { useLogin } from "./useLogin";

/** The Loader and Driver PIN is four digits (login rationales in the Figma file). */
export const PIN_LENGTH = 4;

const lastIdKey = (role: "LOADER" | "DRIVER") => `nextdrop.lastLoginId.${role}`;

/** State for the Loader and Driver sign-in: an ID field plus a PIN typed on the on-screen keypad. */
export function usePinLogin(role: "LOADER" | "DRIVER") {
  const { pending, failure, submit, clearFailure } = useLogin();
  // The last ID used on this device is filled in, so a returning loader or driver only enters the PIN.
  const [loginId, setLoginIdState] = useState(() => readStored(lastIdKey(role)) ?? "");
  const [pin, setPin] = useState("");
  /** Changes on every failed attempt, so the dots can replay their shake. */
  const [attempt, setAttempt] = useState(0);
  const [deviceId] = useState(getDeviceId);

  const request = loginRequestSchema.safeParse({ role, loginId, pin, deviceId });
  const canSubmit = request.success && pin.length === PIN_LENGTH && !pending;

  const setLoginId = useCallback(
    (value: string) => {
      setLoginIdState(value.replace(/\s/g, "").toUpperCase().slice(0, 6));
      clearFailure();
    },
    [clearFailure],
  );

  const pressDigit = useCallback(
    (digit: string) => {
      setPin((current) => (current.length < PIN_LENGTH ? current + digit : current));
      clearFailure();
    },
    [clearFailure],
  );

  const backspace = useCallback(() => {
    setPin((current) => current.slice(0, -1));
    clearFailure();
  }, [clearFailure]);

  const signInWithPin = useCallback(async () => {
    if (!request.success || !canSubmit) return;
    const ok = await submit(request.data);
    if (ok) {
      writeStored(lastIdKey(role), loginId);
    } else {
      setPin("");
      setAttempt((n) => n + 1);
    }
  }, [canSubmit, loginId, request, role, submit]);

  // A hardware keyboard types the PIN too, unless the focus is in the ID field.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.target instanceof HTMLInputElement || event.ctrlKey || event.metaKey || event.altKey) return;
      if (/^\d$/.test(event.key)) pressDigit(event.key);
      else if (event.key === "Backspace") backspace();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [backspace, pressDigit]);

  return { loginId, setLoginId, pin, pressDigit, backspace, attempt, pending, failure, canSubmit, signInWithPin };
}
