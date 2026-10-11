/**
 * Shape checks for hex strings that arrive from a client.
 *
 * These are boundary validation, not security: they reject obviously malformed
 * input before it is stored in a `TEXT` column or compared against a real
 * transaction, so a typo produces a clear 400 instead of a confusing failure
 * deep inside CashScript or a silently un-matchable txid.
 *
 * They are deliberately strict. A transaction hex must be even-length and
 * non-empty; a txid is exactly 32 bytes. Anything looser just moves the
 * failure later.
 */
const HEX_RE = /^[0-9a-fA-F]*$/;

export function isHex(value: unknown): value is string {
  return typeof value === "string" && value.length % 2 === 0 && HEX_RE.test(value);
}

/**
 * A raw transaction hex. Returns a trimmed lowercase copy, or throws.
 */
export function parseTransactionHex(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("signedTransactionHex must be a non-empty hex string");
  }
  const trimmed = value.trim();
  if (!isHex(trimmed)) {
    throw new Error("signedTransactionHex is not valid hex");
  }
  // A BCH transaction is a version marker (4) + inputs + outputs +
  // witnesses + locktime. The smallest conceivable one is well over 10 bytes;
  // anything shorter cannot be a transaction and would only produce a
  // confusing error from the decoder later.
  if (trimmed.length < 20) {
    throw new Error("signedTransactionHex is too short to be a transaction");
  }
  return trimmed.toLowerCase();
}

/**
 * A transaction id: 32 bytes, 64 hex characters. Bitcoin/Cash txids are
 * conventionally displayed in reverse byte order, but the value that comes
 * back from Electrum or a builder is the big-endian hash, which is what gets
 * stored in `funding_txid` / `release_txid` and compared for equality. Case is
 * normalised so a lowercase id from one source matches an uppercase one.
 */
export function parseTxid(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("A transaction id must be a string");
  }
  const trimmed = value.trim();
  if (trimmed.length !== 64 || !isHex(trimmed)) {
    throw new Error("A transaction id must be 64 hex characters (32 bytes)");
  }
  return trimmed.toLowerCase();
}
