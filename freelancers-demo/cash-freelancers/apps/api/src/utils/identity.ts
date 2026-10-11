/**
 * Validation and normalisation for the two identifiers a new account is given.
 *
 * Pure functions only — no database, no network. Availability is a question for
 * the repository, because only it can see the unique indexes.
 *
 * The uniqueness guarantees both of these rely on are enforced by the database
 * (unique indexes on lower(email) and lower(username)), never by the check you
 * see here. A check-then-insert has an unavoidable race — two requests both see
 * the name as free — and the index is what actually makes it correct. These
 * functions exist to give a user a clear message *before* they submit, not to
 * be the thing standing between two accounts and one name.
 */

/** Length in characters of the visible part; the 2 before @ are fixed. */
const MIN_EMAIL_LOCAL = 3;
const MAX_EMAIL_LENGTH = 254;

const MIN_USERNAME_LENGTH = 3;
const MAX_USERNAME_LENGTH = 24;

/**
 * Deliberately conservative. This is not a full RFC 5322 implementation, and
 * trying to be one is how you end up accepting addresses that no real mail
 * server will deliver to. What matters here is rejecting the shapes people
 * actually mistype, and accepting everything a normal mailbox looks like.
 *
 * Note the absence of a confirmation step: nothing verifies that this address
 * belongs to the person who typed it, so it is a lookup name, not a claim of
 * ownership. It must never gate a security decision.
 */
const EMAIL_PATTERN = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validateEmail(email: string): void {
  if (typeof email !== "string" || !email) {
    throw new Error("Email is required");
  }
  if (email.length > MAX_EMAIL_LENGTH) {
    throw new Error("That email address is too long");
  }
  const [local] = email.split("@");
  if (local.length < MIN_EMAIL_LOCAL) {
    throw new Error("That email address does not look complete");
  }
  if (!EMAIL_PATTERN.test(email)) {
    throw new Error("That does not look like a valid email address");
  }
}

/**
 * A public handle, shown in place of a display name and unique across the site.
 *
 * Restricted to ASCII letters, digits, underscore and hyphen so that it can be
 * rendered in a URL, mentioned in plain text and compared without any question
 * of Unicode equivalence — `café` can be written as `café`, `cafe` + combining
 * accent, or two other ways, and three handles that look the same to a person
 * is exactly the problem a unique handle is supposed to prevent. The cost is
 * that some names need a transliteration; the alternative is handles that
 * collide when someone pastes them elsewhere.
 */
export function validateUsername(username: string): string {
  if (typeof username !== "string" || !username) {
    throw new Error("Username is required");
  }
  const trimmed = username.trim();
  if (trimmed.length < MIN_USERNAME_LENGTH) {
    throw new Error(`Username must be at least ${MIN_USERNAME_LENGTH} characters`);
  }
  if (trimmed.length > MAX_USERNAME_LENGTH) {
    throw new Error(`Username must be at most ${MAX_USERNAME_LENGTH} characters`);
  }
  if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) {
    throw new Error("Username can only contain letters, numbers, underscores and hyphens");
  }
  return trimmed.toLowerCase();
}
