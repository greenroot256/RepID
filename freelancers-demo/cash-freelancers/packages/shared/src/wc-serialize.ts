/**
 * JSON encoding for the WalletConnect BCH transaction objects.
 *
 * CashScript's `generateWcTransactionObject()` returns libauth structures:
 * byte fields are `Uint8Array` and satoshi amounts are `bigint`. Neither
 * survives `JSON.stringify`:
 *
 *   - a `bigint` throws outright ("Do not know how to serialize a BigInt"),
 *     which is why the funding route could not send a transaction at all;
 *   - a `Uint8Array` becomes `{"0":2,"1":0,…}`, an object the wallet cannot read
 *     as bytes.
 *
 * libauth's own `stringify` is not the answer either. It is a debugging
 * serializer: it renders those values as the human-readable placeholders
 * `"<Uint8Array: 0x76a9…>"` and `"<bigint: 31000n>"`, which are not hex and not
 * numbers, so a wallet handed them has nothing it can sign.
 *
 * What a WC2-BCH wallet expects instead is ordinary JSON with bytes as hex
 * strings. That is what this produces: `Uint8Array` becomes a lowercase hex
 * string without a `0x` prefix, `bigint` becomes a decimal string (so no value
 * is rounded through a JS number), and `undefined` properties are dropped the
 * way `JSON.stringify` drops them.
 *
 * The conversion is depth-first and structural, so it works on any WC object —
 * the funding object, a covenant spend, or a source-output list.
 */

/** Recursively converts byte/bigint-bearing structures into JSON-safe values. */
export function serializeWcValue(value: unknown): unknown {
  if (value === null) return null;

  if (value instanceof Uint8Array) return bytesToHex(value);
  if (typeof value === "bigint") return value.toString(10);
  if (Array.isArray(value)) return value.map(serializeWcValue);

  if (typeof value === "object") {
    // A Buffer is a Uint8Array subclass, so it is covered above, but being
    // explicit here documents that arrays/views are not walked as objects.
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      // Matches JSON.stringify semantics: an undefined property is absent, not
      // null. `token` on a plain-BCH source output is exactly this case.
      if (entry === undefined) continue;
      result[key] = serializeWcValue(entry);
    }
    return result;
  }

  // string | number | boolean | undefined (only reachable at the top level,
  // since undefined entries are dropped above).
  return value;
}

/** Hex without a `0x` prefix, which is what the WC2-BCH fields carry. */
export function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}
