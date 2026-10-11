// Covenant binding against the real Chipnet run.
//
// The synthetic tests in covenant_binding.test.ts prove the binding check has
// teeth, but they build their transactions with the same toolchain that defines
// the check. That is a closed loop: it cannot catch the check being wrong about
// the toolchain. This file closes it by running the check over transactions that
// were compiled, broadcast and accepted by a BCH node that had no part in
// writing it.
//
// Two kinds of assertion live here, and which one applies depends on the vector:
//
//   * the two identity transactions are 0.3.0-compatible. They must still be
//     recognized, and each must bind to the canonical vault bytecode. This is the
//     positive half, and it would break if the byte layout assumptions in
//     covenant.ts were wrong.
//
//   * the receipt and the two ratings are 0.2.x-era, with their Rating Rights in
//     plain P2PKH. Since 0.3.0 a Rating Right is a RatingRightVault UTXO, so
//     these are negative vectors: they must NOT be recognized, with binding on and
//     off alike. They are kept precisely so that a day someone implements a
//     fallback to the old form, the tests say so loudly.
//
// The ratings used to be the control for "a rating has no covenant, so requiring
// binding on it would be a false rejection". That control cannot come from these
// vectors any more, since none of them is a 0.3.0 receipt; it now lives in
// binding_recognition.test.ts, built against a current one.

import { describe, it, expect, beforeEach } from 'vitest';
import { binToHex } from '@bitauth/libauth';
import {
  indexRawTransaction,
  createMemoryStore,
  decodeRawTransaction,
  toHex,
  verifyVaultOutputBinding,
  verifyRedeemScriptBinding,
  buildP2SH32Hash,
  type RepidStateStore,
  type RepidFact,
  type CanonicalCovenant,
} from '../src/index.js';
import bytecode from '../src/protocol/covenant-bytecode.json' with { type: 'json' };
import chain from './fixtures/real-chain-txs.json' with { type: 'json' };

const VAULT = bytecode.contracts.identityVault as CanonicalCovenant;
const RECEIPT = bytecode.contracts.receiptGenesis as CanonicalCovenant;

const TRANSACTIONS = chain.transactions as {
  txid: string;
  type: string;
  bytes: number;
  hex: string;
}[];

const ratings = () => TRANSACTIONS.filter((t) => t.type === 'RATING_ISSUED');

let store: RepidStateStore;

beforeEach(() => {
  store = createMemoryStore();
});

/** Indexes one transaction and checks it produced the fact type recorded for it. */
function indexOne<T extends RepidFact['type']>(
  tx: { txid: string; type: string; hex: string },
  as: T,
): Extract<RepidFact, { type: T }> {
  const fact = indexRawTransaction(tx.hex, store);
  expect(fact, `${tx.txid} was not recognized`).not.toBeNull();
  expect(fact!.type, `${tx.txid} was recognized as the wrong fact type`).toBe(tx.type);
  return fact as Extract<RepidFact, { type: T }>;
}

/**
 * Replays the run in chain order up to and including `txid`, and returns the fact
 * that transaction produced.
 *
 * The replay is not optional bookkeeping. The index is stateful: a rating only
 * resolves against a Rating Right that an earlier receipt genesis put in the
 * index. `beforeEach` hands every test a fresh store, so any test touching a
 * rating has to rebuild the history that makes the rating meaningful. Indexing
 * out of order would silently yield a different answer, which is why the vectors
 * are stored in chain order and the protocol repository asserts it.
 */
function replayThrough<T extends RepidFact['type']>(txid: string, as: T) {
  const at = TRANSACTIONS.findIndex((t) => t.txid === txid);
  expect(at, `${txid} is not one of the vectors`).toBeGreaterThanOrEqual(0);

  let produced: RepidFact | null = null;
  for (const tx of TRANSACTIONS.slice(0, at + 1)) {
    produced = indexOne(tx, tx.type as RepidFact['type']);
  }
  return produced as Extract<RepidFact, { type: T }>;
}

/**
 * Indexes everything up to and including `txid` without asserting what each
 * transaction produced.
 *
 * Used for the historical vectors, which this version deliberately does not
 * recognize. `replayThrough` cannot serve them: it asserts every earlier
 * transaction yielded the fact type the fixture recorded, and that is exactly
 * the claim 0.3.0 withdraws for the receipt.
 */
function replayHistoryTo(txid: string) {
  const at = TRANSACTIONS.findIndex((t) => t.txid === txid);
  expect(at, `${txid} is not one of the vectors`).toBeGreaterThanOrEqual(0);
  for (const tx of TRANSACTIONS.slice(0, at + 1)) {
    indexRawTransaction(tx.hex, store);
  }
}

describe('the real Chipnet run', () => {
  it('records five transactions that cover three fact types', () => {
    // Guards the premise of every assertion below. If the vectors are swapped
    // for synthetic ones, this fails and the file stops claiming chain evidence.
    expect(TRANSACTIONS).toHaveLength(5);
    expect(chain.provenance.network).toBe('chipnet');
    expect(new Set(TRANSACTIONS.map((t) => t.type))).toEqual(
      new Set(['IDENTITY_GENESIS', 'RECEIPT_GENESIS', 'RATING_ISSUED']),
    );
    for (const tx of TRANSACTIONS) {
      expect(tx.hex.length / 2, `${tx.txid} byte count`).toBe(tx.bytes);
    }
  });

  it('recognizes both identity genesis transactions and binds each to the vault', () => {
    const identities = TRANSACTIONS.filter((t) => t.type === 'IDENTITY_GENESIS');
    expect(identities).toHaveLength(2);

    const owners = new Set<string>();
    for (const tx of identities) {
      const fact = replayThrough(tx.txid, 'IDENTITY_GENESIS');
      const { tx: decoded } = decodeRawTransaction(tx.hex);

      const result = verifyVaultOutputBinding(
        decoded.outputs[0]!.lockingBytecode,
        fact.ownerPkh,
        VAULT,
      );

      // The commitment and the covenant agree on the owner, which is the
      // property that makes the comparison possible at all.
      expect(result.bound, `${tx.txid} did not bind: ${result.reason}`).toBe(true);
      expect(result.expectedScriptHash).toBe(result.foundScriptHash);
      owners.add(fact.ownerPkh);
    }

    // Two distinct owners, so the two matches are not one script matched twice.
    expect(owners.size).toBe(2);
  });

  it('no longer recognizes the receipt genesis on chain, whose rights were in P2PKH', () => {
    const tx = TRANSACTIONS.find((t) => t.type === 'RECEIPT_GENESIS')!;
    const { tx: decoded } = decodeRawTransaction(tx.hex);

    // The covenant requires the genesis input to be vout 0 of its source, which
    // is also the input whose outpoint txid becomes the token category.
    const input = decoded.inputs.find((i) => i.outpointIndex === 0);
    expect(input, 'no input at vout 0').toBeDefined();

    // This transaction was broadcast from the 0.1.0 covenant, which put its two
    // Rating Rights in plain P2PKH. Since 0.3.0 a Rating Right is a
    // RatingRightVault UTXO, so the shape check rejects it (SPEC-009 RF-W58)
    // whether or not binding is applied. There is no fallback to the old form:
    // accepting a right the chain cannot make single-use would reintroduce the
    // guarantee this version moved out of the indexer and onto the chain.
    expect(
      indexRawTransaction(tx.hex, store, { binding: false }),
      'RF-W58: a receipt with P2PKH rights is not a 0.3.0 Receipt',
    ).toBeNull();
    expect(indexRawTransaction(tx.hex, store, { binding: true })).toBeNull();

    // It does not bind either. Given the correct parties *and* the P2SH32 hashes
    // the 0.3.0 genesis would have committed to, the historic script is still a
    // different script: it takes two constructor arguments where the canonical
    // contract takes four. The 0.1.0 rights are P2PKH, so the parties can be read
    // off their locking scripts.
    const pkhOfLock = (o: { lockingBytecode: Uint8Array }) =>
      binToHex(o.lockingBytecode.slice(3, 23));
    const partyA = pkhOfLock(decoded.outputs[1]!);
    const partyB = pkhOfLock(decoded.outputs[2]!);
    const ratingRight = bytecode.contracts.ratingRight as CanonicalCovenant;
    const result = verifyRedeemScriptBinding(
      input!.unlockingBytecode,
      [partyA, partyB, buildP2SH32Hash(ratingRight, [partyA]), buildP2SH32Hash(ratingRight, [partyB])],
      RECEIPT,
    );
    expect(result.bound).toBe(false);
    expect(result.reason).toBe('redeem-script-differs');

    // The historic layout exactly: 122 bytes of bytecode plus two pushed 20-byte
    // pkh values and their two push opcodes. 230 would be the 0.3.0 layout.
    expect(result.revealedLength).toBe(164);
    expect(RECEIPT.bytecodeHex.length / 2).toBe(122);
  });

  it('still binds the identity covenants, which this version did not change', () => {
    // The control for the test above. Adding one require() to the receipt
    // covenant changed only the receipt: the identity genesis and vault are
    // byte-for-byte what they were at 0.1.0, so their historical transactions
    // still bind against the current canonical bytecode. If this ever fails, the
    // problem is not history but the check.
    const identities = TRANSACTIONS.filter((t) => t.type === 'IDENTITY_GENESIS');
    expect(identities).toHaveLength(2);

    for (const tx of identities) {
      const fact = replayThrough(tx.txid, 'IDENTITY_GENESIS');
      const { tx: decoded } = decodeRawTransaction(tx.hex);
      const result = verifyVaultOutputBinding(
        decoded.outputs[0]!.lockingBytecode,
        fact.ownerPkh,
        VAULT,
      );
      expect(result.bound, `${tx.txid} did not bind: ${result.reason}`).toBe(true);
    }
  });

  it('does not recognize the historical ratings, whose Rating Right was never tracked', () => {
    const ratings = TRANSACTIONS.filter((t) => t.type === 'RATING_ISSUED');
    expect(ratings).toHaveLength(2);

    for (const tx of ratings) {
      // These spend plain P2PKH rights, and the receipt that would have put them
      // in the index is not a fact under 0.3.0 (the test above). A rating is only
      // a fact against a tracked Rating Right, so nothing resolves and there is no
      // fact to report — not an invalid one.
      replayHistoryTo(tx.txid);
      expect(
        indexRawTransaction(tx.hex, store, { binding: false }),
        `${tx.txid}: untracked Rating Right`,
      ).toBeNull();
      expect(indexRawTransaction(tx.hex, store, { binding: true })).toBeNull();
    }

    // The positive control for a rating that *is* a fact — a spend with an
    // OP_RETURN and no covenant behind it, which must not be required to bind —
    // now has to be built against a 0.3.0 receipt, and lives in
    // binding_recognition.test.ts. It cannot be produced from these vectors,
    // because nothing here is a 0.3.0 receipt.
  });

  it('keeps the historical scores as a record, without re-deriving them', () => {
    // From real-chain-facts.json: 2 and 3. They are kept as a record of what a
    // real Chipnet run concluded under 0.2.x, not as something this version
    // reproduces: the Rating Rights those ratings spent are not facts here, so
    // there is nothing left to re-derive from. SPEC-009 RF-W57.
    expect(ratings()).toHaveLength(2);
    expect(chain.provenance.network).toBe('chipnet');
  });

  it('leaves the identity NFT committed to the owner the vault covenant holds', () => {
    // A last consistency check that costs nothing and would catch a decoder that
    // mixed up the two views of the same owner: the NFT commitment, the covenant
    // argument and the change output all have to name the same party.
    const tx = TRANSACTIONS.find((t) => t.type === 'IDENTITY_GENESIS')!;
    const fact = replayThrough(tx.txid, 'IDENTITY_GENESIS');
    const { tx: decoded } = decodeRawTransaction(tx.hex);

    expect(toHex(decoded.outputs[0]!.token!.nft!.commitment!)).toBe(fact.ownerPkh);
    // The change is tokenless BCH to the same owner, which is what makes the
    // genesis a two-output shape in the first place.
    expect(decoded.outputs[1]!.token).toBeUndefined();
    expect(binToHex(decoded.outputs[1]!.lockingBytecode)).toBe(
      `76a914${fact.ownerPkh}88ac`,
    );
  });
});
