// Shared test scaffolding.
//
// Extracted from the four original indexer test files, which each carried an
// identical copy. The scenarios and assertions are unchanged; only the
// duplicated boilerplate moved here.
//
// Note on `MockNetworkProvider`: `sendRawTransaction` does not execute the
// Bitcoin VM, so a successful send is not evidence that a covenant is correct.
// But `TransactionBuilder.send()` with a contract input *does* run that
// contract's `require` statements in a debug VM, and throws when one fails.
//
// These tests need to build well-formed transactions, and the builder is the
// way to do that. The cost is that a transaction a covenant forbids cannot be
// built at all, so a negative test which routes through the builder proves
// nothing: the builder refuses it and the recognizer never runs. Tests for a
// shape the covenant already rejects must perturb the outputs of a canonical
// transaction instead -- see `receipt_genesis_shape.test.ts`. Covenant
// conformance still rests on real-VM runs, which is why no test here claims it.

import { expect } from 'vitest';
import { Contract, MockNetworkProvider, type Utxo } from 'cashscript';
import {
  generatePrivateKey,
  secp256k1,
  hash160,
  lockingBytecodeToCashAddress,
  binToHex,
  utf8ToBin,
} from '@bitauth/libauth';
import { OP_RETURN_TAGS } from '../src/constants.js';
import { hexToBytes } from '../src/bytes.js';
import { buildP2SH32Hash, type CanonicalCovenant } from '../src/covenant.js';
import covenantBytecode from '../src/protocol/covenant-bytecode.json' with { type: 'json' };
import ratingRightArtifact from './fixtures/rating_right.json' with { type: 'json' };
import type { FactType, RepidFact } from '../src/types.js';

export interface Party {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  pkh: Uint8Array;
  address: string;
  pkhHex: string;
}

/**
 * Narrows libauth's `string | Uint8Array` return types.
 *
 * Those signatures are loose, so a cast would be the easy way out. A runtime
 * check is used instead: if libauth ever changes what it returns, the tests
 * fail with a clear message rather than comparing a hex string against bytes
 * and reporting a mismatch that has nothing to do with the code under test.
 */
function asBytes(value: string | Uint8Array, what: string): Uint8Array {
  if (typeof value === 'string') {
    throw new Error(`expected ${what} to be bytes, but libauth returned a hex string`);
  }
  return value;
}

/**
 * A deterministic party. The seed is passed in rather than kept in a module
 * counter so each test file controls its own key derivation exactly as the
 * original suite did.
 */
export function makeParty(seed: number): Party {
  const privateKey = generatePrivateKey(() => new Uint8Array(32).fill(seed));
  const publicKey = asBytes(secp256k1.derivePublicKeyCompressed(privateKey), 'publicKey');
  const pkh = asBytes(hash160(publicKey), 'pkh');
  const p2pkhBytecode = new Uint8Array([0x76, 0xa9, 0x14, ...pkh, 0x88, 0xac]);
  const addressResult = lockingBytecodeToCashAddress({
    bytecode: p2pkhBytecode,
    prefix: 'bchtest',
    tokenSupport: true,
  });
  if (typeof addressResult === 'string') throw new Error(addressResult);
  return { privateKey, publicKey, pkh, address: addressResult.address, pkhHex: binToHex(pkh) };
}

/**
 * The unlocker of a CashScript contract, after checking the named functions exist.
 *
 * CashScript types every function of the unlocker map as optional
 * (`((...functionParameters: any[]) => Unlocker) | undefined`) because the map is
 * derived from a generic ABI, even though a compiled fixture artifact always
 * contains the functions it declares. Calling `contract.unlock.mint(...)`
 * directly is therefore a type error in strict mode.
 *
 * The alternative, casting the map to a hand-written type, would be worse: it
 * discards the artifact-generated types and would happily accept a call to a
 * function the artifact does not have. So the existence of each function is
 * checked for real here, and the call sites assert only the optionality that the
 * runtime check above has already established. A missing function fails with a
 * message naming it, instead of "mint is not a function" from inside the builder.
 */
export function unlocker<TMap extends object>(contract: { unlock?: TMap }, ...names: string[]): TMap {
  const map = contract.unlock as Record<string, unknown> | undefined;
  if (!map) {
    throw new Error('contract artifact has no unlocker; the fixture is not a compiled contract');
  }
  for (const name of names) {
    if (typeof map[name] !== 'function') {
      throw new Error(`contract artifact has no function "${name}"`);
    }
  }
  return map as TMap;
}

export function makeProvider(): MockNetworkProvider {
  return new MockNetworkProvider();
}

export function mockUtxo(txid: string, satoshis: bigint, vout = 0): Utxo {
  return { txid, vout, satoshis };
}

// OP_RETURN of an ISSUED_RATING: OP_RETURN <tag> <score (1 byte)>
export function ratingOpReturnOutput(score: number) {
  const tagBytes = utf8ToBin(OP_RETURN_TAGS.RATING);
  const scoreBytes = new Uint8Array([score]);
  const bytecode = new Uint8Array([
    0x6a,
    tagBytes.length,
    ...tagBytes,
    scoreBytes.length,
    ...scoreBytes,
  ]);
  return { to: bytecode, amount: 0n };
}

// OP_RETURN of a TRUST_LINK: OP_RETURN <tag> <trusted pkh (20 bytes)>.
// Unilateral: only the truster signs and pays.
export function trustOpReturnOutput(trustedPkhHex: string) {
  const tagBytes = utf8ToBin(OP_RETURN_TAGS.TRUST);
  const pkhBytes = hexToBytes(trustedPkhHex);
  const bytecode = new Uint8Array([
    0x6a,
    tagBytes.length,
    ...tagBytes,
    pkhBytes.length,
    ...pkhBytes,
  ]);
  return { to: bytecode, amount: 0n };
}

// OP_RETURN of a PLATFORM_CONFIRMATION: OP_RETURN <tag> <Receipt txid (32 bytes)>
export function platformOpReturnOutput(receiptTxidHex: string) {
  const tagBytes = utf8ToBin(OP_RETURN_TAGS.PLATFORM);
  const txidBytes = hexToBytes(receiptTxidHex);
  const bytecode = new Uint8Array([
    0x6a,
    tagBytes.length,
    ...tagBytes,
    txidBytes.length,
    ...txidBytes,
  ]);
  return { to: bytecode, amount: 0n };
}

/** An OP_RETURN whose tag is not a RepID tag. */
export function foreignTagOpReturnOutput(alienTag: string) {
  const alienBytes = utf8ToBin(alienTag);
  return { to: new Uint8Array([0x6a, alienBytes.length, ...alienBytes]), amount: 0n };
}

/**
 * Asserts that `fact` exists and is of the given type, then returns it narrowed.
 *
 * The original JavaScript tests read `fact.type` directly, which is fine in JS
 * and a lie in TypeScript: it asserts the fact exists without checking it. This
 * helper makes the assertion real, so a recognizer that returned `null` fails
 * with a useful message instead of a confusing property error.
 */
export function expectFact<T extends FactType>(
  fact: RepidFact | null,
  type: T,
): Extract<RepidFact, { type: T }> {
  expect(fact, `expected a ${type} fact but the transaction was not recognized`).not.toBeNull();
  expect(fact?.type, `expected a ${type} fact`).toBe(type);
  return fact as Extract<RepidFact, { type: T }>;
}

/**
 * The P2SH32 hashes a ReceiptGenesisValidator takes to lock both Rating Rights
 * under the canonical RatingRightVault (SPEC-008 RF-O825, SPEC-009 RF-W58).
 *
 * CashScript 0.13 cannot reference a contract by name, so the commitment travels
 * through the genesis constructor instead. Every test that mints a receipt has
 * to compute these, and a test that computed them wrongly would fail with an
 * unhelpful builder error rather than pointing at the cause, so it lives here
 * once.
 */
export function ratingRightHashes(partyA: Party, partyB: Party): { hashA: string; hashB: string } {
  const ratingRight = covenantBytecode.contracts.ratingRight as CanonicalCovenant;
  return {
    hashA: buildP2SH32Hash(ratingRight, [partyA.pkhHex]),
    hashB: buildP2SH32Hash(ratingRight, [partyB.pkhHex]),
  };
}

/**
 * The two covenant instances a receipt genesis locks its Rating Rights under.
 *
 * Since 0.3.0 a Rating Right is a `RatingRightVault` UTXO (SPEC-008 RF-O822), so
 * the genesis needs the vault instantiated separately for each party: sending the
 * rights to the genesis contract's own address would produce a P2SH32 whose hash
 * is not the one the genesis committed to, and the covenant would refuse the
 * transaction with a `require` failure that says nothing about the cause.
 */
export function receiptRights(
  provider: MockNetworkProvider,
  partyA: Party,
  partyB: Party,
): { vaultForA: Contract; vaultForB: Contract } {
  return {
    vaultForA: new Contract(ratingRightArtifact, [partyA.pkh], { provider }),
    vaultForB: new Contract(ratingRightArtifact, [partyB.pkh], { provider }),
  };
}

/**
 * The four constructor arguments of a ReceiptGenesisValidator for this pair.
 *
 * The last two are the P2SH32 hashes of `RatingRightVault`, which the genesis
 * cannot compute itself (SPEC-008 RF-O825).
 */
export function receiptGenesisArgs(
  partyA: Party,
  partyB: Party,
): [Uint8Array, Uint8Array, Uint8Array, Uint8Array] {
  const { hashA, hashB } = ratingRightHashes(partyA, partyB);
  return [partyA.pkh, partyB.pkh, hexToBytes(hashA), hexToBytes(hashB)];
}

/** The same arguments as `receiptGenesisArgs`, as hex, for binding checks. */
export function receiptGenesisArgsHex(
  partyA: Party,
  partyB: Party,
): [string, string, string, string] {
  const { hashA, hashB } = ratingRightHashes(partyA, partyB);
  return [partyA.pkhHex, partyB.pkhHex, hashA, hashB];
}
