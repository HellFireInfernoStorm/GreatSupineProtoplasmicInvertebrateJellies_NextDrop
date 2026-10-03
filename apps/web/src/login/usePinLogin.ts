import { loginRequestSchema, type LoginRequest } from "@nextdrop/contracts";
import { useCallback, useEffect, useEffectEvent, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { getDeviceId } from "../lib/device";
import type { FieldRole } from "../lib/fieldRoles";
import { readStored, writeStored } from "../lib/storage";
import { useLogin } from "./useLogin";

/** The Loader and Driver PIN is four digits (login rationales in the Figma file). */
export const PIN_LENGTH = 4;

/** Marks the on-screen keypad keys, so Enter on one of them signs in instead of repeating its digit. */
export const PIN_KEY_ATTRIBUTE = "data-pin-key";

const lastIdKey = (role: FieldRole) => `nextdrop.lastLoginId.${role}`;

/** State for the Loader and Driver sign-in: an ID field plus a PIN typed on the on-screen keypad. */
export function usePinLogin(role: FieldRole) {
  // One login state for the form and the quick-login chips, so an error from either clears as soon as the user types.
  const { pending, failure, submit, clearFailure } = useLogin();
  // The last ID used on this device is filled in, so a returning loader or driver only enters the PIN.
  const [loginId, setLoginIdState] = useState(() => readStored(lastIdKey(role)) ?? "");
  const [pin, setPin] = useState("");
  /** Changes on every failed PIN attempt, so the dots can replay their shake. */
  const [attempt, setAttempt] = useState(0);
  const [deviceId] = useState(getDeviceId);

  const request = loginRequestSchema.safeParse({ role, loginId, pin, deviceId });
  const canSubmit = request.success && pin.length === PIN_LENGTH && !pending;
  // The contract decides what a complete ID is; any digit stands in for the PIN here.
  const idComplete = loginRequestSchema.safeParse({ role, loginId, pin: "0", deviceId }).success;

  const setLoginId = useCallback(
    (value: string) => {
      setLoginIdState(value.replace(/\s/g, "").toUpperCase().slice(0, 6));
      clearFailure();
    },
    [clearFailure],
  );

  // While a sign-in is in flight the PIN is frozen: keys from the keypad or a keyboard must not change it.
  const pressDigit = useCallback(
    (digit: string) => {
      if (pending) return;
      setPin((current) => (current.length < PIN_LENGTH ? current + digit : current));
      clearFailure();
    },
    [clearFailure, pending],
  );

  const backspace = useCallback(() => {
    if (pending) return;
    setPin((current) => current.slice(0, -1));
    clearFailure();
  }, [clearFailure, pending]);

  const signInWithPin = useCallback(async () => {
    if (!request.success || !canSubmit) return;
    const failed = await submit(request.data);
    if (failed === null) {
      writeStored(lastIdKey(role), loginId);
    } else if (failed === "invalid" || failed === "locked") {
      // The server refused the PIN: clear it and shake. On a network failure the PIN stays, ready to retry.
      setPin("");
      setAttempt((n) => n + 1);
    }
  }, [canSubmit, loginId, request, role, submit]);

  /** A quick-login chip. It shares this login's pending and failure state. */
  const quickLogin = useCallback((account: LoginRequest) => void submit(account), [submit]);

  /**
   * In the ID field with a hardware keyboard: once the ID is complete, digits go to the PIN, and Backspace takes
   * PIN digits back first. So typing `LDR001`, `1234`, Enter signs in without leaving the field.
   */
  const onIdKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (/^\d$/.test(event.key) && idComplete) {
        event.preventDefault();
        pressDigit(event.key);
      } else if (event.key === "Backspace" && pin.length > 0) {
        event.preventDefault();
        backspace();
      }
    },
    [backspace, idComplete, pin.length, pressDigit],
  );

  // Outside the ID field, a hardware keyboard types the PIN directly, and Enter signs in once it is complete.
  // Enter on a focused button keeps its own meaning, except on a keypad key, where it would only repeat a digit.
  const onWindowKeyDown = useEffectEvent((event: KeyboardEvent) => {
    const target = event.target;
    if (target instanceof HTMLInputElement || event.ctrlKey || event.metaKey || event.altKey) return;
    if (/^\d$/.test(event.key)) pressDigit(event.key);
    else if (event.key === "Backspace") backspace();
    else if (event.key === "Enter" && canSubmit) {
      if (target instanceof HTMLButtonElement && !target.hasAttribute(PIN_KEY_ATTRIBUTE)) return;
      event.preventDefault();
      void signInWithPin();
    }
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onWindowKeyDown(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  return {
    loginId,
    setLoginId,
    onIdKeyDown,
    pin,
    pressDigit,
    backspace,
    attempt,
    pending,
    failure,
    canSubmit,
    signInWithPin,
    quickLogin,
  };
}
