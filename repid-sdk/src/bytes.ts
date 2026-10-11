// Byte-level helpers shared by the recognizers.
//
// Byte order, stated once because getting it wrong is expensive and silent:
// inside a CashScript covenant `tokenCategory` arrives in internal (inverted)
// order, while libauth's decoder returns both `outpointTransactionHash` and
// `token.category` already in display order. Nothing here inverts anything,
// and nothing should.

import { binToHex, hash160 } from '@bitauth/libauth';
import type { Pkh } from './types.js';

const HEX_ALPHABET = /^[0-9a-fA-F]*$/;

/**
 * Strict hex to bytes.
 *
 * The previous implementation used a substring parse that silently produced
 * zeros for invalid characters, because `parseInt('zz', 16)` is `NaN` and
 * assigning `NaN` into a `Uint8Array` stores 0. That turned malformed input
 * into plausible-looking bytes. This throws instead: a fact derived from a
 * garbled transaction is worse than an error.
 */
export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;

  if (clean.length % 2 !== 0) {
    throw new Error(`Invalid transaction hex: odd length (${clean.length})`);
  }
  if (!HEX_ALPHABET.test(clean)) {
    throw new Error('Invalid transaction hex: contains non-hex characters');
  }

  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Lowercase hex, no `0x`. Every hex string a fact carries goes through here, so
 * the rendering is decided in one place instead of at each call site.
 */
export function toHex(bytes: Uint8Array): string {
  return binToHex(bytes);
}

/** True when `b` appears in `a` starting at `offset`. */
export function bytesEqual(a: Uint8Array, b: Uint8Array, offset = 0): boolean {
  if (a.length - offset < b.length) return false;
  for (let i = 0; i < b.length; i += 1) {
    if (a[offset + i] !== b[i]) return false;
  }
  return true;
}

const P2PKH_PREFIX = new Uint8Array([0x76, 0xa9, 0x14]); // OP_DUP OP_HASH160 <push 20>
const P2PKH_SUFFIX = new Uint8Array([0x88, 0xac]); // OP_EQUALVERIFY OP_CHECKSIG

/**
 * The pkh of a standard P2PKH locking script, or null.
 *
 * RepID tokens are always locked to a plain P2PKH, never to P2SH, which is why
 * a vault covenant shows up as "not P2PKH" and is recognized by its commitment
 * instead.
 */
export function extractP2PKH(lockingBytecode: Uint8Array | undefined): Pkh | null {
  if (!lockingBytecode || lockingBytecode.length !== 25) return null;
  if (!bytesEqual(lockingBytecode, P2PKH_PREFIX, 0)) return null;
  if (!bytesEqual(lockingBytecode, P2PKH_SUFFIX, 23)) return null;
  return binToHex(lockingBytecode.slice(3, 23));
}

/**
 * The pkh of whoever signed, recovered from a standard P2PKH scriptSig.
 *
 * A scriptSig is `<sig> <33-byte compressed pubkey>`, so the pubkey push opcode
 * sits exactly 34 bytes from the end. Trust Links and Platform Confirmations
 * both name their actor this way, which is what lets a unilateral declaration
 * say who made it without any identity being involved.
 */
export function extractPkhFromUnlocking(
  unlockingBytecode: Uint8Array | undefined,
): Pkh | null {
  if (!unlockingBytecode || unlockingBytecode.length < 35) return null;
  const end = unlockingBytecode.length;
  if (unlockingBytecode[end - 34] !== 0x21) return null;
  return binToHex(hash160(unlockingBytecode.slice(end - 33, end)));
}

/** A parsed OP_RETURN: its leading chunk decoded as text, plus every chunk. */
export interface ParsedOpReturn {
  tag: string;
  chunks: Uint8Array[];
}

/**
 * Splits an OP_RETURN locking script into chunks without running the VM.
 *
 * Only direct pushes are accepted. `OP_PUSHDATA1`/`OP_PUSHDATA2` and a zero
 * length are rejected rather than handled, because no RepID fact is emitted with
 * them and accepting them would widen what counts as a tag.
 *
 * A push whose declared length runs past the end of the script is also rejected
 * (RF-W45). `Uint8Array.slice` clamps instead of throwing, so without the check
 * below a push claiming five bytes and carrying one is read as a one-byte chunk
 * and the truncation is invisible. Under `REPID_RATING1` that one byte is a
 * score, so the script it produces looks like a well-formed rating that no one
 * ever wrote.
 *
 * Returns null rather than throwing: an unparseable container is a shape that
 * emits no fact, not an error in the input.
 */
export function parseOpReturn(lockingBytecode: Uint8Array): ParsedOpReturn | null {
  if (lockingBytecode[0] !== 0x6a) return null;

  let offset = 1; // skip OP_RETURN
  const chunks: Uint8Array[] = [];

  while (offset < lockingBytecode.length) {
    const len = lockingBytecode[offset];
    if (len === undefined) break;
    offset += 1;
    if (len === 0 || len > 75) return null;
    // RF-W45: the declared length must be satisfiable by what follows.
    if (offset + len > lockingBytecode.length) return null;
    chunks.push(lockingBytecode.slice(offset, offset + len));
    offset += len;
  }

  if (chunks.length < 2) return null;
  const first = chunks[0];
  if (!first) return null;
  return { tag: new TextDecoder().decode(first), chunks };
}
