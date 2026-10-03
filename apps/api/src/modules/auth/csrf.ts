import { createHmac, timingSafeEqual } from "node:crypto";

export const CSRF_HEADER = "x-nextdrop-csrf";

/** The session's CSRF token: an HMAC of its id, so no extra column is needed (ADR 0026). */
export function csrfToken(secret: string, sessionId: string): string {
  return createHmac("sha256", secret).update(`csrf:${sessionId}`).digest("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function headerValue(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}
