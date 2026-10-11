// SPEC-009 Annex B.3: the 0.4.0 recognition vectors.
//
// Each row of the annex table gets a test here, built as raw transactions
// (libauth encoder + bytecode assembled by hand) so the recognizer is exercised
// against the exact shapes the specification tables, without a covenant needing
// to sign anything. The two covenant-backed rows (13 and 14) are the exception
// and are asserted at the bytecode/binding level, with the network-level
// execution of the burn gate left to the protocol repository's VM suite.
//
// The genesis transactions are minted here with plain P2PKH inputs: binding is
// off for the shape rows, and MockNetworkProvider's inability to run the VM
// makes that the honest way to exercise recognition without pretending a script
// was verified.

import { encodeTransactionBCH, hash160, hashTransaction } from '@bitauth/libauth';
import { describe, expect, it } from 'vitest';

import covenantBytecode from '../src/protocol/covenant-bytecode.json' with { type: 'json' };
import {
  createMemoryStore,
  indexRawTransaction,
  OP_RETURN_TAGS,
  SUPPORTED_PROTOCOL_VERSIONS,
  type RepidStateStore,
} from '../src/index.js';
import { hexToBytes, toHex } from '../src/bytes.js';

const HASH = (byte: string, count: number): string => byte.repeat(count);
const CATEGORY = HASH('cc', 32);
const PUBKEY_A = `02${HASH('aa', 32)}`;
const PUBKEY_B = `02${HASH('bb', 32)}`;
const PUBKEY_PLATFORM = `02${HASH('dd', 32)}`;
const pkhA = toHex(hash160(hexToBytes(PUBKEY_A)));
const pkhB = toHex(hash160(hexToBytes(PUBKEY_B)));

/** P2PKH locking bytecode. */
const p2pkh = (pkh: string): Uint8Array => hexToBytes(`76a914${pkh}88ac`);

/** P2SH32 (`OP_HASH256 <32> OP_EQUAL`) locking bytecode. */
const p2sh32 = (hash: string): Uint8Array => hexToBytes(`aa20${hash}87`);

/** An OP_RETURN made of direct pushes, as `parseOpReturn` reads them. */
const opReturn = (tag: string, ...chunks: Uint8Array[]): Uint8Array => {
  const tagBytes = new TextEncoder().encode(tag);
  const parts: number[] = [0x6a, tagBytes.length, ...tagBytes];
  for (const chunk of chunks) {
    parts.push(chunk.length);
    for (const byte of chunk) parts.push(byte);
  }
  return Uint8Array.from(parts);
};

/** An NFT to lock an output, capability `none` and no fungible amount. */
const nft = (category: string, commitment: string) => ({
  category: hexToBytes(category),
  amount: 0n,
  nft: { capability: 'none' as const, commitment: hexToBytes(commitment) },
});

/** A standard P2PKH scriptSig that resolves to `pubkeyHex`. */
const signScriptSig = (pubkeyHex: string): Uint8Array => {
  const pubkey = hexToBytes(pubkeyHex);
  const parts: number[] = [0x41, ...new Array(65).fill(0), 0x21, ...pubkey];
  return Uint8Array.from(parts);
};

/** A covenant spend scriptSig revealing `redeemScript` as its final push. */
const revealScriptSig = (pubkeyHex: string, redeemScript: Uint8Array): Uint8Array => {
  const pubkey = hexToBytes(pubkeyHex);
  const parts: number[] = [0x41, ...new Array(65).fill(0), 0x21, ...pubkey, 0x00, 0x4c, redeemScript.length];
  for (const byte of redeemScript) parts.push(byte);
  return Uint8Array.from(parts);
};

interface Input {
  txid: string;
  vout: number;
  scriptSig: Uint8Array;
}

interface Output {
  value: bigint;
  bytecode: Uint8Array;
  token?: { category: Uint8Array; amount: bigint; nft: { capability: 'none' | 'mutable' | 'minting'; commitment: Uint8Array } };
}

/** Encodes a transaction and returns its hex and display-order txid. */
function buildTx(inputs: Input[], outputs: Output[]): { raw: string; txid: string } {
  const encoded = encodeTransactionBCH({
    version: 2,
    inputs: inputs.map((input) => ({
      outpointTransactionHash: hexToBytes(input.txid),
      outpointIndex: input.vout,
      sequenceNumber: 0xfffffffe,
      unlockingBytecode: input.scriptSig,
    })),
    outputs: outputs.map((output) => ({
      lockingBytecode: output.bytecode,
      valueSatoshis: output.value,
      ...(output.token ? { token: output.token } : {}),
    })),
    locktime: 0,
  });
  if (typeof encoded === 'string') {
    throw new Error(`encoding failed: ${encoded}`);
  }
  const binary = encoded as unknown as Uint8Array;
  return { raw: toHex(binary), txid: hashTransaction(binary) };
}

/**
 * A structurally valid Receipt genesis: Receipt NFT to partyA's P2PKH with
 * `contextCommitment` (empty = legacy form), Rating Rights locked to two
 * different P2SH32 vault addresses, each naming the other party.
 */
function receiptGenesis(contextCommitment: string): { raw: string; txid: string } {
  return buildTx(
    [{ txid: HASH('ff', 32), vout: 0, scriptSig: signScriptSig(PUBKEY_A) }],
    [
      { value: 1n, bytecode: p2pkh(pkhA), token: nft(CATEGORY, contextCommitment) },
      { value: 1n, bytecode: p2sh32(HASH('11', 32)), token: nft(CATEGORY, pkhB) },
      { value: 1n, bytecode: p2sh32(HASH('22', 32)), token: nft(CATEGORY, pkhA) },
    ],
  );
}

/** A fresh store with a recognized Receipt and a rating recorded against it. */
function ratedStore(): { store: RepidStateStore; receiptTxid: string } {
  const store = createMemoryStore();
  const receipt = receiptGenesis('');
  const genesisFact = indexRawTransaction(receipt.raw, store);
  if (genesisFact?.type !== 'RECEIPT_GENESIS') {
    throw new Error('test setup: receipt genesis not recognized');
  }
  const ratingTx = buildTx(
    [{ txid: receipt.txid, vout: 1, scriptSig: signScriptSig(PUBKEY_A) }],
    [{ value: 0n, bytecode: opReturn(OP_RETURN_TAGS.RATING, Uint8Array.of(4)) }],
  );
  const ratingFact = indexRawTransaction(ratingTx.raw, store);
  if (ratingFact?.type !== 'RATING_ISSUED') {
    throw new Error('test setup: rating not recognized');
  }
  return { store, receiptTxid: receipt.txid };
}

describe('SPEC-009 Annex B.3: 0.4.0 recognition vectors', () => {
  describe('REPID_RATING2 (vector 1-3, RF-W64/RF-W65)', () => {
    it('issues a RATING_ISSUED with score and commentHash from a well-formed REPID_RATING2', () => {
      const store = createMemoryStore();
      const receipt = receiptGenesis('');
      expect(indexRawTransaction(receipt.raw, store)?.type).toBe('RECEIPT_GENESIS');

      const commentHash = HASH('55', 32);
      const ratingTx = buildTx(
        [{ txid: receipt.txid, vout: 1, scriptSig: signScriptSig(PUBKEY_A) }],
        [{ value: 0n, bytecode: opReturn(OP_RETURN_TAGS.RATING2, Uint8Array.of(3), hexToBytes(commentHash)) }],
      );
      const fact = indexRawTransaction(ratingTx.raw, store);
      expect(fact?.type).toBe('RATING_ISSUED');
      if (fact?.type !== 'RATING_ISSUED') return;
      expect(fact.score).toBe(3);
      expect(fact.commentHash).toBe(commentHash);
      expect(fact.raterPkh).toBe(pkhA);
      expect(fact.rateePkh).toBe(pkhB);
      expect(fact.spentOutpoint).toBe(`${receipt.txid}:1`);
      expect(fact.valid).toBe(true);
      expect(store.hasRating(pkhA, receipt.txid)).toBe(true);
    });

    it('emits no fact for a REPID_RATING2 with only the score', () => {
      const store = createMemoryStore();
      const receipt = receiptGenesis('');
      expect(indexRawTransaction(receipt.raw, store)?.type).toBe('RECEIPT_GENESIS');
      const ratingTx = buildTx(
        [{ txid: receipt.txid, vout: 1, scriptSig: signScriptSig(PUBKEY_A) }],
        [{ value: 0n, bytecode: opReturn(OP_RETURN_TAGS.RATING2, Uint8Array.of(3)) }],
      );
      expect(indexRawTransaction(ratingTx.raw, store)).toBeNull();
    });

    it('emits no fact for a REPID_RATING2 shaped like the two-chunk REPID_RATING1', () => {
      const store = createMemoryStore();
      const receipt = receiptGenesis('');
      expect(indexRawTransaction(receipt.raw, store)?.type).toBe('RECEIPT_GENESIS');
      const ratingTx = buildTx(
        [{ txid: receipt.txid, vout: 1, scriptSig: signScriptSig(PUBKEY_A) }],
        [{ value: 0n, bytecode: opReturn(OP_RETURN_TAGS.RATING2, Uint8Array.of(3), Uint8Array.of(4)) }],
      );
      expect(indexRawTransaction(ratingTx.raw, store)).toBeNull();
    });
  });

  describe('REPID_RETRACT1 (vector 4-8, RF-W66 to RF-W70)', () => {
    it('a valid retraction of a rating its signer issued', () => {
      const { store, receiptTxid } = ratedStore();
      const retractTx = buildTx(
        [{ txid: HASH('33', 32), vout: 0, scriptSig: signScriptSig(PUBKEY_A) }],
        [{ value: 0n, bytecode: opReturn(OP_RETURN_TAGS.RETRACT, hexToBytes(receiptTxid)) }],
      );
      const fact = indexRawTransaction(retractTx.raw, store);
      expect(fact).toMatchObject({
        type: 'RATING_RETRACTION',
        raterPkh: pkhA,
        receiptTxid,
        valid: true,
      });
      expect(store.isRatingRetracted(pkhA, receiptTxid)).toBe(true);
    });

    it('a retraction whose payload is 20 bytes, not 32', () => {
      const { store } = ratedStore();
      const retractTx = buildTx(
        [{ txid: HASH('33', 32), vout: 0, scriptSig: signScriptSig(PUBKEY_A) }],
        [{ value: 0n, bytecode: opReturn(OP_RETURN_TAGS.RETRACT, hexToBytes(HASH('ab', 20))) }],
      );
      expect(indexRawTransaction(retractTx.raw, store)).toBeNull();
    });

    it('a retraction of a rating this recognizer never saw', () => {
      const { store } = ratedStore();
      const retractTx = buildTx(
        [{ txid: HASH('33', 32), vout: 0, scriptSig: signScriptSig(PUBKEY_A) }],
        [{ value: 0n, bytecode: opReturn(OP_RETURN_TAGS.RETRACT, hexToBytes(HASH('77', 32))) }],
      );
      const fact = indexRawTransaction(retractTx.raw, store);
      expect(fact).toMatchObject({ type: 'RATING_RETRACTION', valid: false });
    });

    it('a retraction spent by a wallet that is not the rating signer', () => {
      const { store, receiptTxid } = ratedStore();
      const retractTx = buildTx(
        [{ txid: HASH('33', 32), vout: 0, scriptSig: signScriptSig(PUBKEY_B) }],
        [{ value: 0n, bytecode: opReturn(OP_RETURN_TAGS.RETRACT, hexToBytes(receiptTxid)) }],
      );
      const fact = indexRawTransaction(retractTx.raw, store);
      expect(fact).toMatchObject({ type: 'RATING_RETRACTION', raterPkh: pkhB, valid: false });
    });

    it('a second retraction of an already-retracted rating', () => {
      const { store, receiptTxid } = ratedStore();
      const retract = (): unknown =>
        indexRawTransaction(
          buildTx(
            [{ txid: HASH('33', 32), vout: 0, scriptSig: signScriptSig(PUBKEY_A) }],
            [{ value: 0n, bytecode: opReturn(OP_RETURN_TAGS.RETRACT, hexToBytes(receiptTxid)) }],
          ).raw,
          store,
        );
      const first = retract();
      expect(first).toMatchObject({ raterPkh: pkhA, valid: true });
      const second = retract();
      expect(second).toMatchObject({ raterPkh: pkhA, valid: false });
      expect(store.isRatingRetracted(pkhA, receiptTxid)).toBe(true);
    });
  });

  describe('platform self-corroboration (vector 9, RF-W71)', () => {
    it('a party of the Receipt cannot corroborate its own interaction', () => {
      const store = createMemoryStore();
      const receipt = receiptGenesis('');
      expect(indexRawTransaction(receipt.raw, store)?.type).toBe('RECEIPT_GENESIS');

      const confirmTx = buildTx(
        [{ txid: HASH('44', 32), vout: 0, scriptSig: signScriptSig(PUBKEY_A) }],
        [{ value: 0n, bytecode: opReturn(OP_RETURN_TAGS.PLATFORM, hexToBytes(receipt.txid)) }],
      );
      const fact = indexRawTransaction(confirmTx.raw, store);
      expect(fact).toMatchObject({ type: 'PLATFORM_CONFIRMATION', platformPkh: pkhA, receiptTxid: receipt.txid, valid: false });
    });

    it('a third party who is neither party still corroborates', () => {
      const store = createMemoryStore();
      const receipt = receiptGenesis('');
      expect(indexRawTransaction(receipt.raw, store)?.type).toBe('RECEIPT_GENESIS');

      const confirmTx = buildTx(
        [{ txid: HASH('44', 32), vout: 0, scriptSig: signScriptSig(PUBKEY_PLATFORM) }],
        [{ value: 0n, bytecode: opReturn(OP_RETURN_TAGS.PLATFORM, hexToBytes(receipt.txid)) }],
      );
      const fact = indexRawTransaction(confirmTx.raw, store);
      expect(fact).toMatchObject({ type: 'PLATFORM_CONFIRMATION', valid: true });
    });
  });

  describe('Receipt interaction context (vector 10-12, RF-W73)', () => {
    it('decodes a 4-byte 0x10 context, keeping unknown values raw', () => {
      const store = createMemoryStore();
      const receipt = receiptGenesis('1002ab01');
      const fact = indexRawTransaction(receipt.raw, store);
      expect(fact?.type).toBe('RECEIPT_GENESIS');
      if (fact?.type !== 'RECEIPT_GENESIS') return;
      expect(fact.receiptContext).toEqual({ interactionCategory: '02', roleA: 'ab', roleB: '01' });
      // RF-W74: the indexer retains the context alongside the Receipt.
      expect(store.getReceipt(receipt.txid)?.receiptContext).toEqual(fact.receiptContext);
    });

    it('decodes a 36-byte 0x11 context with its contextHash', () => {
      const store = createMemoryStore();
      const receipt = receiptGenesis(`11010203${HASH('5a', 32)}`);
      const fact = indexRawTransaction(receipt.raw, store);
      expect(fact?.type).toBe('RECEIPT_GENESIS');
      if (fact?.type !== 'RECEIPT_GENESIS') return;
      const context = {
        interactionCategory: '01',
        roleA: '02',
        roleB: '03',
        contextHash: HASH('5a', 32),
      };
      expect(fact.receiptContext).toEqual(context);
      // RF-W74: the indexer retains the context alongside the Receipt.
      expect(store.getReceipt(receipt.txid)?.receiptContext).toEqual(context);
    });

    it('rejects every foreign commitment shape', () => {
      // 1, 3 and 5 bytes; 4 bytes in the 0x11 format; 4 bytes with a reserved
      // format byte; and 36 bytes in an undefined format. Only the two fixed
      // forms are facts; anything else is a Receipt carrying a payload the
      // protocol does not define, so no fact.
      const commitments = [
        '00',
        '100102',
        '1001020304',
        '11010203',
        '1f010203',
        `12010203${HASH('5a', 32)}`,
      ];
      for (const commitment of commitments) {
        const store = createMemoryStore();
        const receipt = receiptGenesis(commitment);
        expect(indexRawTransaction(receipt.raw, store)).toBeNull();
      }
    });
  });

  describe('the versioned vault bodies (vector 13, RF-O831)', () => {
    const registry = covenantBytecode.contracts.identityVault as unknown as {
      versions?: Record<string, { bytecodeHex: string }>;
    };
    const body30 = registry.versions?.['0.3.0']?.bytecodeHex ?? '';
    const body40 = registry.versions?.['0.4.0']?.bytecodeHex ?? '';

    it('declares both versions, and the 0.4.0 body is the 0.3.0 body with the burn gate inserted', () => {
      expect(SUPPORTED_PROTOCOL_VERSIONS).toContain('0.3.0');
      expect(SUPPORTED_PROTOCOL_VERSIONS).toContain('0.4.0');
      expect(body30.length).toBeGreaterThan(0);
      expect(body40.length).toBeGreaterThan(0);

      // Annex B.3 vector 13: the only difference between the two declared
      // bodies is the gate that delays burning behind the 144-block age.
      // `02 90 00 b2 75` is the minimal push of 144 followed by the comparison
      // and verification opcodes; nothing else changes, so a 0.4.0 deployment
      // reads everywhere else exactly like a 0.3.0 one.
      const GATE = '029000b275';
      const firstDifferent = [...body40].findIndex((_, index) => body40[index] !== body30[index]);
      expect(firstDifferent).toBeGreaterThan(0);
      expect(body40.slice(0, firstDifferent)).toBe(body30.slice(0, firstDifferent));
      expect(body40.slice(firstDifferent, firstDifferent + GATE.length)).toBe(GATE);
      expect(body40.slice(firstDifferent + GATE.length)).toBe(body30.slice(firstDifferent));

      // The executable evidence that the gate does what it says is the VM
      // suite in the protocol repository: conformance/identity-vault-burn-delay
      // (6 tests: 143/144/145 blocks, seconds, disable, re-enable), run against
      // the real engine in task E.1. This test pins the bytes; that suite pins
      // the behavior.
    });
  });

  describe('binding a spend to the version recorded at genesis (vector 14, RF-W76)', () => {
    const registry = covenantBytecode.contracts.identityVault as unknown as {
      versions?: Record<string, { bytecodeHex: string }>;
    };
    const body40 = registry.versions?.['0.4.0']?.bytecodeHex ?? '';
    const identityOutpoint = `${HASH('99', 32)}:0`;

    const burnVault = (bodyHex: string, pubkey: string): { raw: string } => {
      const redeemScript = hexToBytes(`14${pkhA}${bodyHex}`);
      return buildTx(
        [{ txid: HASH('99', 32), vout: 0, scriptSig: revealScriptSig(pubkey, redeemScript) }],
        // No NFT reappears, so the identity burns and the collateral returns.
        [{ value: 1000n, bytecode: p2pkh(pkhA) }],
      );
    };

    it('rejects a spend revealing the 0.4.0 body for an identity recorded under 0.3.0', () => {
      const store = createMemoryStore();
      store.trackIdentity(identityOutpoint, {
        ownerPkh: pkhA,
        identityCategory: CATEGORY,
        collateral: '1000',
        vaultVersion: '0.3.0',
      });
      const burn = burnVault(body40, PUBKEY_A);
      expect(indexRawTransaction(burn.raw, store, { binding: true })).toBeNull();
      // The rejected spend must leave no trace.
      expect(store.snapshot().identities).toHaveLength(1);
    });

    it('the same spend is a burn when the identity records 0.4.0', () => {
      const store = createMemoryStore();
      store.trackIdentity(identityOutpoint, {
        ownerPkh: pkhA,
        identityCategory: CATEGORY,
        collateral: '1000',
        vaultVersion: '0.4.0',
      });
      const burn = burnVault(body40, PUBKEY_A);
      const fact = indexRawTransaction(burn.raw, store, { binding: true });
      expect(fact).toMatchObject({ type: 'IDENTITY_BURNED', ownerPkh: pkhA, valid: true });
      expect(store.snapshot().identities).toHaveLength(0);
    });

    it('an identity recorded without a version cannot be spent under binding at all', () => {
      const store = createMemoryStore();
      store.trackIdentity(identityOutpoint, {
        ownerPkh: pkhA,
        identityCategory: CATEGORY,
        collateral: '1000',
      });
      const burn = burnVault(body40, PUBKEY_A);
      expect(indexRawTransaction(burn.raw, store, { binding: true })).toBeNull();
    });

    it('with binding off, the same spend is still reported: shape recognition claims nothing about covenants', () => {
      const store = createMemoryStore();
      store.trackIdentity(identityOutpoint, {
        ownerPkh: pkhA,
        identityCategory: CATEGORY,
        collateral: '1000',
        vaultVersion: '0.3.0',
      });
      const burn = burnVault(body40, PUBKEY_A);
      const fact = indexRawTransaction(burn.raw, store);
      expect(fact).toMatchObject({ type: 'IDENTITY_BURNED', valid: true });
    });
  });
});