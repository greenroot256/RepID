import argon2 from "argon2";

/**
 * Password hashing.
 *
 * argon2id is the right default here: it is the variant that resists both
 * GPU cracking (like argon2i) and side-channel attacks (like argon2d), and
 * `argon2.verify` is constant-time in the sense that matters — it does not
 * short-circuit on the first wrong byte.
 *
 * The parameters are deliberately left at the library's own defaults, which
 * track the current OWASP recommendation, rather than pinned to numbers chosen
 * today. `needsRehash` below is what turns a parameter bump into a silent,
 * free upgrade: an existing user rehashes with the new cost the next time they
 * sign in, and nobody has to be logged out to apply it.
 */

/**
 * OWASP's floor for a user-chosen password is a length, not a composition
 * rule. Rejecting passwords for lacking a digit or a capital letter pushes
 * people towards `Password1!`, which is weaker than a long passphrase, so the
 * only rules enforced are length and a guard against obvious filler.
 */
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 200;

export class PasswordPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PasswordPolicyError";
  }
}

export function assertPasswordPolicy(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new PasswordPolicyError(
      `Use at least ${MIN_PASSWORD_LENGTH} characters. A short passphrase beats a short word with a digit on the end.`
    );
  }
  // bcrypt-style truncation: argon2 would silently ignore the tail of anything
  // this long, so two different long passwords could end up identical.
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new PasswordPolicyError(`Passwords are limited to ${MAX_PASSWORD_LENGTH} characters.`);
  }
  if (password.trim().length === 0) {
    throw new PasswordPolicyError("A password cannot be only whitespace.");
  }
}

export async function hashPassword(password: string): Promise<string> {
  assertPasswordPolicy(password);
  return argon2.hash(password, { type: argon2.argon2id });
}

/**
 * Checks a password against a stored hash.
 *
 * A user with no password is a real case, not a bug: accounts that predate
 * passwords can still sign in with a linked wallet, and are asked to set one
 * so they survive losing that wallet. Returning false rather than throwing
 * keeps every caller from having to special-case null.
 */
export async function verifyPassword(
  password: string,
  storedHash: string | null | undefined
): Promise<boolean> {
  if (!storedHash) return false;
  try {
    return await argon2.verify(storedHash, password);
  } catch {
    // A malformed or truncated hash in the database must not become a 500:
    // it is a failed sign-in as far as the caller is concerned.
    return false;
  }
}

/**
 * True when the stored hash was made with weaker parameters than the ones in
 * use now. Rehash transparently after a successful sign-in rather than waiting
 * for a forced reset, which nobody ever completes.
 */
export async function passwordNeedsRehash(storedHash: string): Promise<boolean> {
  try {
    // needsRehash compares cost parameters only — the variant is carried in the
    // hash string itself, so passing an empty options object here compares
    // against the library's current defaults, which is exactly the comparison
    // wanted: "was this made with costs we would still choose today?"
    return await argon2.needsRehash(storedHash);
  } catch {
    return false;
  }
}
