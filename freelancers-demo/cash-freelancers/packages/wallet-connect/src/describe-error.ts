/**
 * Turning whatever was thrown into something a person can read.
 *
 * The WalletConnect SDK does not always throw an `Error`. It rejects with
 * plain JSON-RPC error objects (`{ code, message }`), and on a few failure
 * paths — an unreachable relay, a rejected pairing, a missing project ID — it
 * rejects with a bare `{}` that has no message at all. Code that does
 * `(err as Error).message || "something went wrong"` throws away every bit of
 * that: the object survives to the console as `{}` and the UI shows a generic
 * string, so the actual cause is never visible.
 *
 * This walks the shapes that actually come out of the SDK, in order of how
 * much they tell us, and never returns an empty string. An unreadable error is
 * a bug in itself — it costs more time than the code that produced it.
 */

/** JSON-RPC / WalletConnect error codes that mean "the user said no". */
const USER_REJECTED_CODES = new Set([5000, 5001, 5002, 6000]);

interface RpcErrorLike {
  code?: unknown;
  message?: unknown;
  data?: unknown;
  name?: unknown;
}

/**
 * True when the rejection is the user closing the wallet's sheet or declining
 * the request, rather than something having gone wrong. Those are normal
 * outcomes of a handshake and must not be reported as failures.
 */
export function isUserRejection(err: unknown): boolean {
  if (!isRecord(err)) return false;
  const { code } = err;
  return typeof code === "number" && USER_REJECTED_CODES.has(code);
}

/**
 * A human-readable, non-empty description of a thrown value. Prefers the
 * message, then the structured fields, then whatever `JSON.stringify` can
 * salvage, and finally says plainly that the value carried no information —
 * which is itself a finding worth surfacing rather than a blank screen.
 */
export function describeError(err: unknown): string {
  if (err === null) return "null";
  if (err === undefined) return "undefined";
  if (typeof err === "string") return err.trim() || '"" (an empty string)';
  if (typeof err === "number" || typeof err === "boolean") return String(err);

  if (err instanceof Error) {
    const code = codeOf(err);
    const data = dataSuffix(err, code);
    return code ? `${err.message} (code ${code})${data}` : `${err.message}${data}`;
  }

  if (isRecord(err)) {
    const message = asNonEmptyString(err.message);
    const code = codeOf(err);
    const data = dataSuffix(err, code);

    if (message) return code ? `${message} (code ${code})${data}` : `${message}${data}`;
    if (code !== null) {
      return `WalletConnect error ${code} with no message${data}`;
    }
    // No message and no code: fall back to whatever shape this object has, but
    // say that it was message-less so the output is not mistaken for content.
    return `${stringified(err)} (no message)${dataSuffix(err, null)}`;
  }

  // A function, a symbol, a Map… `JSON.stringify` returns undefined for most.
  return stringified(err) ?? Object.prototype.toString.call(err);
}

function isRecord(value: unknown): value is RpcErrorLike {
  return typeof value === "object" && value !== null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function codeOf(value: unknown): number | null {
  if (isRecord(value) && typeof value.code === "number") return value.code;
  return null;
}

/** JSON-RPC errors can carry a nested `data` object with the useful detail. */
function dataSuffix(value: unknown, code: number | null): string {
  if (isRecord(value) && value.data !== undefined) {
    const json = stringified(value.data);
    // The code is already rendered in the message; a data blob that is just
    // the code again adds nothing.
    if (json && json !== String(code)) return ` — ${json}`;
  }
  return "";
}

function stringified(value: unknown): string | null {
  try {
    const json = JSON.stringify(value);
    return json && json !== "{}" ? json : null;
  } catch {
    // Circular structures and BigInt are both reachable from arbitrary input.
    return null;
  }
}
