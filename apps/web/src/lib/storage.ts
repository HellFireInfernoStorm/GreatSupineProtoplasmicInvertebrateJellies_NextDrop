// Small device preferences only (language, last login ID, device ID). Storage can be unavailable (private mode),
// so reads and writes never throw. The outbox and offline data live in Dexie, never here (apps/web/AGENTS.md).

function area(kind: "local" | "session"): Storage | null {
  try {
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export function readStored(key: string, kind: "local" | "session" = "local"): string | null {
  try {
    return area(kind)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string | null, kind: "local" | "session" = "local"): void {
  try {
    if (value === null) area(kind)?.removeItem(key);
    else area(kind)?.setItem(key, value);
  } catch {
    // Storage is full or blocked: the preference is simply not remembered.
  }
}
