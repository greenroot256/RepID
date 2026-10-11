// Covenant binding: proving a fact came from a covenant, not only that it has the
// right output shape.
//
// The problem this exists to solve. A recognizer that only looks at outputs
// cannot tell the canonical covenant from an impostor that mints the same shape.
// CashTokens lets any script create a token category, so a plain P2PKH input at
// vout 0 is enough to mint an identity NFT or a full set of Rating Rights without
// any covenant running. A shape-based recognizer reports those as facts, and
// SPEC-009 §11 declared the gap rather than closing it. This closes it, without
// running the VM: a P2SH script hash commits to its redeem script, so the bytes
// are on chain even though the script behind the hash is not in the locking
// script.
//
// How a comparison is possible at all. Both covenants take pkh arguments in
// their constructor, so the deployed script is the compiler bytecode preceded by
// the serialized arguments, and *every instance has a different script hash*:
//
//   contract IdentityVault(bytes20 ownerPkh)
//   contract ReceiptGenesisValidator(bytes20 partyAPkh, bytes20 partyBPkh)
//
// There is therefore no single constant to compare against. The recognizer
// already derives the relevant pkh values from the outputs it is reading, which
// makes the expected script fully determined, and the comparison becomes exact
// rather than heuristic. That is the same information the covenant itself uses:
// `require(tx.outputs[1].lockingBytecode == new LockingBytecodeP2PKH(partyBPkh))`.
//
// Two compiler details decide the byte layout, and both were established by
// reading real spends rather than by reading the compiler's documentation:
//
//   * The arguments are pushed *inside* the script, ahead of the body, each with
//     its own minimal push opcode, and in **reverse declaration order**. The
//     stack is LIFO, so the last declared argument is pushed first. The vault
//     deploys `0x14 || ownerPkh || body`; the receipt deploys
//     `0x14 || partyBPkh || 0x14 || partyAPkh || body`. Getting the order wrong
//     yields a different script and therefore a different hash, so this is not a
//     detail a comparison can be lenient about.
//   * The script hash is `hash256` (double SHA-256) over the whole script,
//     committed in a 35-byte P2SH locking script `OP_HASH256 <32> OP_EQUAL`
//     rather than the 23-byte `OP_HASH160 <20> OP_EQUAL` form. Both forms are
//     accepted here, because a vault could legitimately be locked to either, but
//     the hash width determines which function is the right one.
//
// The canonical bytecode is synced from the protocol repository
// (`protocol/covenant-bytecode.json`), because the committed artifacts cannot
// serve: their `bytecode` field holds disassembled mnemonics, not bytes.
//
// Scope. Only the two covenant-backed facts are bound. Trust Links and Platform
// Confirmations are deliberately plain P2PKH spends with an `OP_RETURN` and have
// no covenant to check, which is correct: they are unilateral and need no
// authorization beyond their own signature.
//
// What a failed binding means. It is a rejection, not a fact marked invalid. A
// transaction that has the right shape but did not come from the covenant is not
// a RepID fact that happened to turn out badly; it is not a RepID fact at all, and
// emitting it with `valid: false` would assert the opposite, that the protocol
// knows about this thing and disapproves of it. The distinction matters because
// `valid: false` is already a defined protocol value with a different job
// (SPEC-009 RF-W08: a rating whose score is out of range is still reported, so a
// consumer can see that the attempt was made). Reusing it for "this was never a
// RepID transaction" would overload it and give a consumer no way to tell a
// reported-but-invalid fact from an unrecognized one. So the profile rejects,
// and rejection is visible as the transaction not producing a fact at all.
//
// Ask the locking script first, and only then the unlocking one. This ordering is
// load-bearing, not stylistic. `readP2SHHash` returns null for a plain P2PKH, so
// it answers "is there a covenant here?" honestly and lets a caller tell "no
// covenant to check" (a legacy genesis, which stays recognized) from "the
// covenant does not match" (an impostor, which is rejected). Reversed, it breaks:
// `readRedeemScript` takes the final push of an unlocking script, and a P2PKH
// spend ends in a 65-byte signature, so a legacy genesis looks exactly like a
// vault instantiated for the wrong owner — a rejection of history, on the strength
// of a signature.

import { binToHex, hash160, hash256 } from '@bitauth/libauth';
import { hexToBytes } from './bytes.js';

/** One declared constructor parameter, as recorded by the compiler. */
export interface ConstructorInput {
  name: string;
  type: string;
}

/** The canonical bytecode of one covenant. */
export interface CanonicalCovenant {
  bytecodeHex: string;
  constructorInputs: ConstructorInput[];
}

/** Why a shape-matched fact was not bound to a covenant. */
export type BindingFailure =
  | 'output-is-not-p2sh'
  | 'no-redeem-script-revealed'
  | 'redeem-script-differs'
  | 'script-hash-differs'
  | 'unsupported-constructor-type'
  | 'missing-constructor-argument';

export interface BindingResult {
  /** True when the fact is provably the output of the canonical covenant. */
  bound: boolean;
  /** Present when `bound` is false. Never throws at a call site. */
  reason?: BindingFailure;
  /** The script hash the canonical covenant would have for these arguments. */
  expectedScriptHash?: string;
  /** The script hash actually found on chain, when one could be read. */
  foundScriptHash?: string;
  /** The revealed script length, for diagnostics. */
  revealedLength?: number;
  expectedLength?: number;
}

/** Which hash function a P2SH locking script commits to, keyed by its width. */
type P2shForm = { hash: string; algorithm: 'hash256' | 'hash160' };

/**
 * The script hash committed by a P2SH locking script, or null if it is not P2SH.
 *
 * Two forms are recognized, and they are told apart by length so there is no
 * ambiguity to resolve:
 *
 *   35 bytes  `aa 20 <32-byte hash> 87`   the form a CashTokens P2SH uses
 *   23 bytes  `a9 14 <20-byte hash> 87`   the classic OP_HASH160 form
 *
 * A P2PKH is 25 bytes and starts with OP_DUP, so an output locked straight to a
 * pubkey-hash address cannot be mistaken for a covenant here.
 */
export function readP2SHHash(
  lockingBytecode: Uint8Array | undefined,
): (P2shForm & { hash: string }) | null {
  if (!lockingBytecode) return null;
  const hex = binToHex(lockingBytecode);

  if (hex.length === 70) {
    if (hex.slice(0, 4) === 'aa20' && hex.slice(68) === '87') {
      return { hash: hex.slice(4, 68), algorithm: 'hash256' };
    }
    return null;
  }
  if (hex.length === 46) {
    if (hex.slice(0, 4) === 'a914' && hex.slice(44) === '87') {
      return { hash: hex.slice(4, 44), algorithm: 'hash160' };
    }
    return null;
  }
  return null;
}

/** The minimal push of some data, as a scriptSig emits it. */
function readPushAt(script: Uint8Array, i: number): { start: number; length: number } | null {
  const opcode = script[i]!;
  if (opcode >= 0x01 && opcode <= 0x4b) return { start: i + 1, length: opcode };
  if (opcode === 0x4c) {
    if (i + 2 > script.length) return null;
    return { start: i + 2, length: script[i + 1]! };
  }
  if (opcode === 0x4d) {
    if (i + 3 > script.length) return null;
    return { start: i + 3, length: script[i + 1]! | (script[i + 2]! << 8) };
  }
  if (opcode === 0x4e) {
    if (i + 5 > script.length) return null;
    return {
      start: i + 5,
      length:
        (script[i + 1]! |
          (script[i + 2]! << 8) |
          (script[i + 3]! << 16) |
          (script[i + 4]! << 24)) >>>
        0,
    };
  }
  return null;
}

/**
 * The last push of a scriptSig, which is where the redeem script lives.
 *
 * Located rather than parsed sequentially, because a real covenant scriptSig is
 * not a clean run of pushes: the vault's is
 * `<collateral> <signature> <pubkey> OP_0 <redeemScript>`, and the `OP_0` in
 * particular is not a data push at all. Requiring the whole scriptSig to be
 * pushes would report every genuine spend as unparseable.
 *
 * The test is simply that the push's data runs exactly to the end of the
 * scriptSig, which no earlier push can do. Scanning from the front and taking
 * the first match therefore yields the final push. All four push encodings are
 * handled because the deployed covenants are 221 and 164 bytes long, well past
 * what a single-byte length can express.
 */
export function findFinalPush(
  unlockingBytecode: Uint8Array | undefined,
): { opcodeAt: number; start: number; data: Uint8Array } | null {
  if (!unlockingBytecode || unlockingBytecode.length === 0) return null;
  for (let i = 0; i < unlockingBytecode.length; i += 1) {
    const push = readPushAt(unlockingBytecode, i);
    if (push && push.start + push.length === unlockingBytecode.length) {
      return {
        opcodeAt: i,
        start: push.start,
        data: unlockingBytecode.slice(push.start, push.start + push.length),
      };
    }
  }
  return null;
}

/** The redeem script a covenant spend reveals, or null if there is not one. */
export function readRedeemScript(unlockingBytecode: Uint8Array | undefined): Uint8Array | null {
  return findFinalPush(unlockingBytecode)?.data ?? null;
}

/**
 * The exact script the canonical covenant deploys for these constructor
 * arguments: each argument minimally pushed, in reverse declaration order,
 * followed by the compiler bytecode.
 *
 * `bytes20` pushes as `0x14 <20>` and `bytes32` as `0x20 <32>`, which is what the
 * compiler emits for each.
 *
 * Throws on an argument shape this module cannot serialize, because a silently
 * wrong expected script would make every comparison below meaningless. Callers
 * turn that into a `BindingFailure` rather than letting it escape.
 */
export function buildExpectedScript(
  covenant: CanonicalCovenant,
  args: (string | undefined)[],
): Uint8Array {
  const { constructorInputs } = covenant;
  if (args.length !== constructorInputs.length) {
    throw new Error(
      `constructor arity mismatch: expected ${constructorInputs.length}, got ${args.length}`,
    );
  }

  const parts: Uint8Array[] = [];
  for (let i = constructorInputs.length - 1; i >= 0; i -= 1) {
    const input = constructorInputs[i]!;
    // ReceiptGenesisValidator takes bytes32 as well as bytes20: its last two
    // arguments are P2SH32 hashes rather than pkhs (SPEC-008 RF-O825), and the
    // width decides the minimal push. CashScript has no push operator for a bare
    // 32 bytes other than the single-byte `0x20`, which is what a 32-byte
    // argument compiles to.
    const width = input.type === 'bytes32' ? 32 : input.type === 'bytes20' ? 20 : 0;
    if (width === 0) {
      throw new Error(`unsupported constructor type ${input.type} for ${input.name}`);
    }
    const value = args[i];
    if (!value || value.length !== width * 2) {
      throw new Error(`constructor argument ${input.name} must be ${width} bytes of hex`);
    }
    parts.push(new Uint8Array([width]), hexToBytes(value));
  }
  parts.push(hexToBytes(covenant.bytecodeHex));

  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const script = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    script.set(part, offset);
    offset += part.length;
  }
  return script;
}

/** The two reasons `buildExpectedScript` can refuse, kept apart for the caller. */
function failureFor(error: unknown): BindingFailure {
  const message = (error as Error).message;
  return message.includes('unsupported constructor type')
    ? 'unsupported-constructor-type'
    : 'missing-constructor-argument';
}

/**
 * Verifies an output that is supposed to hold the identity NFT: is it locked by
 * the canonical vault covenant instantiated with this owner?
 *
 * Checking the locking script is what defeats the impostor. The attacker cannot
 * choose the hash: it is the hash of a script they would have to publish, and the
 * only script that produces a matching hash for a given owner is the covenant
 * itself. Nothing here runs the VM.
 */
export function verifyVaultOutputBinding(
  lockingBytecode: Uint8Array | undefined,
  ownerPkh: string,
  covenant: CanonicalCovenant,
): BindingResult {
  let expectedScriptHash: string;
  try {
    expectedScriptHash = binToHex(hash256(buildExpectedScript(covenant, [ownerPkh])));
  } catch (error) {
    return { bound: false, reason: failureFor(error) };
  }

  const form = readP2SHHash(lockingBytecode);
  if (!form) {
    return { bound: false, reason: 'output-is-not-p2sh', expectedScriptHash };
  }

  // The locking script tells us which hash width is in play, and therefore which
  // function committed it. Comparing a 32-byte payload against hash160 would
  // never match, so the form has to drive the algorithm rather than be assumed.
  const expected =
    form.algorithm === 'hash160'
      ? binToHex(hash160(buildExpectedScript(covenant, [ownerPkh])))
      : expectedScriptHash;

  if (form.hash !== expected) {
    return {
      bound: false,
      reason: 'script-hash-differs',
      expectedScriptHash: expected,
      foundScriptHash: form.hash,
    };
  }
  return { bound: true, expectedScriptHash: expected, foundScriptHash: form.hash };
}

/**
 * Verifies a spend that is supposed to be the covenant: does the input reveal
 * the canonical script for these constructor arguments?
 *
 * Compared as bytes, not as a hash. The redeem script is in hand here, so there
 * is no reason to weaken the check, and the byte comparison also pins the
 * argument values rather than only the program.
 */
export function verifyRedeemScriptBinding(
  unlockingBytecode: Uint8Array | undefined,
  args: (string | undefined)[],
  covenant: CanonicalCovenant,
): BindingResult {
  let expected: Uint8Array;
  try {
    expected = buildExpectedScript(covenant, args);
  } catch (error) {
    return { bound: false, reason: failureFor(error) };
  }
  const expectedScriptHash = binToHex(hash256(expected));
  const revealed = readRedeemScript(unlockingBytecode);

  if (!revealed) {
    return {
      bound: false,
      reason: 'no-redeem-script-revealed',
      expectedScriptHash,
      expectedLength: expected.length,
    };
  }

  if (binToHex(revealed) !== binToHex(expected)) {
    return {
      bound: false,
      reason: 'redeem-script-differs',
      expectedScriptHash,
      revealedLength: revealed.length,
      expectedLength: expected.length,
    };
  }
  return { bound: true, expectedScriptHash, revealedLength: revealed.length };
}

/**
 * The P2SH32 hash of a covenant instantiated with `args` (SPEC-009 RF-W58).
 *
 * SPEC-008 RF-O825 has ReceiptGenesisValidator lock each Rating Right to the
 * P2SH32 hash of RatingRightVault rather than to the covenant by name, because
 * CashScript 0.13 cannot reference another contract. That commitment travels
 * through the genesis contract's constructor arguments, so verifying a receipt
 * genesis means rebuilding its expected script with two arguments this module
 * does not receive: the two hashes are *derived* here from the canonical
 * RatingRightVault bytecode and the parties already established, never taken
 * from the transaction under verification. Taking them from the transaction
 * would make the check agree with whatever it was handed (RF-W56).
 *
 * P2SH32 and not P2SH20 because that is what `new Contract(...)` produces, so
 * this is the only form a deployed covenant address can have.
 */
export function buildP2SH32Hash(
  covenant: CanonicalCovenant,
  args: (string | undefined)[],
): string {
  return binToHex(hash256(buildExpectedScript(covenant, args)));
}
