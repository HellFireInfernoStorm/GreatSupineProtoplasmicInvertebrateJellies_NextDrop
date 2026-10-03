import argon2 from "argon2";

/** Hash a password or PIN with argon2id (spec/platform/auth.md). */
export function hashSecret(secret: string): Promise<string> {
  return argon2.hash(secret, { type: argon2.argon2id });
}

// Verified when no account matches, so unknown login IDs cost the same time as wrong secrets.
let decoy: Promise<string> | undefined;

export async function verifySecret(hash: string | null, secret: string): Promise<boolean> {
  if (hash === null) {
    decoy ??= hashSecret("decoy-secret-never-matches");
    await argon2.verify(await decoy, secret).catch(() => false);
    return false;
  }
  try {
    return await argon2.verify(hash, secret);
  } catch {
    // A malformed stored hash never authenticates.
    return false;
  }
}
