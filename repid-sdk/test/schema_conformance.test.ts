// Ties the recognizer's output to the normative schema.
//
// The TypeScript types in `src/types.ts` and the JSON Schema in the protocol
// repository are two descriptions of the same thing, and two descriptions drift.
// This suite is what stops them: every fact the recognizer actually emits, from
// real transaction shapes, is validated against the schema that the protocol
// declares normative. If a field is renamed in the implementation and not in the
// specification, this fails.
//
// Ajv is a devDependency on purpose. A schema validator is a useful thing for a
// consumer to run at their own boundary, but making the SDK depend on one at
// runtime would tax every user who only wants to recognize transactions. The
// schema itself is exported (`@repid/sdk/protocol/schemas/...`) for anyone who
// does want it.

import { describe, it, expect, beforeEach } from 'vitest';
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import { Contract, MockNetworkProvider, TransactionBuilder, SignatureTemplate, type Utxo } from 'cashscript';
import schemaJson from '../src/protocol/schemas/repid-fact.schema.json' with { type: 'json' };
import { indexRawTransaction, createMemoryStore, OP_RETURN_TAGS } from '../src/index.js';
import { toHex } from '../src/bytes.js';
import identityArtifact from './fixtures/identity_genesis.json' with { type: 'json' };
import vaultArtifact from './fixtures/identity_vault.json' with { type: 'json' };
import receiptArtifact from './fixtures/receipt_genesis.json' with { type: 'json' };
import {
  makeParty,
  makeProvider,
  mockUtxo,
  ratingOpReturnOutput,
  trustOpReturnOutput,
    platformOpReturnOutput,
    unlocker,
  receiptGenesisArgs,
  receiptRights,
    type Party,
  } from './helpers.js';

const ajv = new Ajv2020({ strict: true, allErrors: true });
const validate: ValidateFunction = ajv.compile(schemaJson);

function check(fact: unknown): string[] {
  return validate(fact as object) ? [] : (validate.errors ?? []).map((e) => `${e.instancePath} ${e.message}`);
}

const HEX40 = 'a1'.repeat(20);
const HEX32 = 'b2'.repeat(32);
const HEX64 = 'c3'.repeat(32);

describe('emitted facts satisfy the normative schema', () => {
  it('accepts a well-formed fact of each of the eight types', () => {
    const representative: Record<string, unknown> = {
      IDENTITY_GENESIS: {
        type: 'IDENTITY_GENESIS',
        txid: HEX64,
        identityCategory: HEX64,
        ownerPkh: HEX40,
        collateral: '1000',
        identityOutpoint: `${HEX64}:0`,
      },
      IDENTITY_COLLATERAL_TOP_UP: {
        type: 'IDENTITY_COLLATERAL_TOP_UP',
        txid: HEX64,
        identityCategory: HEX64,
        ownerPkh: HEX40,
        spentOutpoint: `${HEX64}:0`,
        previousCollateral: '1000',
        collateral: '1500',
        valid: true,
      },
      IDENTITY_BURNED: {
        type: 'IDENTITY_BURNED',
        txid: HEX64,
        identityCategory: HEX64,
        ownerPkh: HEX40,
        spentOutpoint: `${HEX64}:0`,
        valid: true,
      },
      RECEIPT_GENESIS: {
        type: 'RECEIPT_GENESIS',
        txid: HEX64,
        receiptCategory: HEX64,
        receiptOwnerPkh: HEX40,
        ratingRights: [
          { outpoint: `${HEX64}:1`, ownerPkh: HEX40, ratesPkh: HEX40 },
          { outpoint: `${HEX64}:2`, ownerPkh: HEX40, ratesPkh: HEX40 },
        ],
      },
      RATING_ISSUED: {
        type: 'RATING_ISSUED',
        txid: HEX64,
        spentOutpoint: `${HEX64}:1`,
        raterPkh: HEX40,
        rateePkh: HEX40,
        score: 4,
        valid: true,
      },
      PLATFORM_CONFIRMATION: {
        type: 'PLATFORM_CONFIRMATION',
        txid: HEX64,
        platformPkh: HEX40,
        receiptTxid: HEX64,
        valid: true,
      },
      TRUST_LINK: {
        type: 'TRUST_LINK',
        txid: HEX64,
        trusterPkh: HEX40,
        trustedPkh: HEX40,
        valid: true,
      },
      RATING_RETRACTION: {
        type: 'RATING_RETRACTION',
        txid: HEX64,
        raterPkh: HEX40,
        receiptTxid: HEX64,
        valid: true,
      },
    };

    for (const [name, fact] of Object.entries(representative)) {
      expect(check(fact), `${name} should satisfy the schema`).toEqual([]);
    }
  });

  it('accepts the 0.4.0 optional fields: commentHash and receiptContext', () => {
    // New in 0.4.0: REPID_RATING2 carries commentHash and the Receipt's NFT
    // commitment can carry an interaction context. Absent from the required-only
    // representative above, so they get their own, exercised per schema.
    expect(
      check({
        type: 'RATING_ISSUED',
        txid: HEX64,
        spentOutpoint: `${HEX64}:1`,
        raterPkh: HEX40,
        rateePkh: HEX40,
        score: 5,
        commentHash: HEX64,
        valid: true,
      }),
    ).toEqual([]);

    expect(
      check({
        type: 'RECEIPT_GENESIS',
        txid: HEX64,
        receiptCategory: HEX64,
        receiptOwnerPkh: HEX40,
        ratingRights: [
          { outpoint: `${HEX64}:1`, ownerPkh: HEX40, ratesPkh: HEX40 },
          { outpoint: `${HEX64}:2`, ownerPkh: HEX40, ratesPkh: HEX40 },
        ],
        receiptContext: {
          interactionCategory: '1f',
          roleA: '02',
          roleB: 'ab',
          contextHash: HEX64,
        },
      }),
    ).toEqual([]);
  });

  it('rejects a fact carrying a field the schema does not define', () => {
    const errors = check({
      type: 'TRUST_LINK',
      txid: HEX64,
      trusterPkh: HEX40,
      trustedPkh: HEX40,
      valid: true,
      // An application annotation leaking into a protocol fact. The demo's own
      // indexer used to add `at` and `roles`; the schema is what stops that
      // from becoming part of the protocol.
      at: '2026-09-10T00:00:00.000Z',
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('accepts an out-of-range score only when the fact declares it invalid', () => {
    // The whole reason the schema does not bound the score at 1-5: the protocol
    // requires the rejected attempt to be reported, not discarded.
    expect(
      check({
        type: 'RATING_ISSUED',
        txid: HEX64,
        spentOutpoint: `${HEX64}:1`,
        raterPkh: HEX40,
        rateePkh: HEX40,
        score: 200,
        valid: false,
      }),
    ).toEqual([]);

    expect(
      check({
        type: 'RATING_ISSUED',
        txid: HEX64,
        spentOutpoint: `${HEX64}:1`,
        raterPkh: HEX40,
        rateePkh: HEX40,
        score: 200,
        valid: true,
      }).length,
    ).toBeGreaterThan(0);
  });

  it('rejects a score that is not a single byte', () => {
    expect(
      check({
        type: 'RATING_ISSUED',
        txid: HEX64,
        spentOutpoint: `${HEX64}:1`,
        raterPkh: HEX40,
        rateePkh: HEX40,
        score: 256,
        valid: false,
      }).length,
    ).toBeGreaterThan(0);
  });
});

// --- The part that matters: facts produced by the recognizer itself --------

const provider: MockNetworkProvider = makeProvider();
let seedCounter = 0;

beforeEach(() => {
  provider.reset();
  seedCounter = 0;
});

/** The covenant UTXO holding the identity NFT, found the way a real wallet would. */
async function findCovenantUtxo(contract: Contract<typeof vaultArtifact>, category: string): Promise<Utxo> {
  const found = (await provider.getUtxos(contract.address)).find((candidate) => {
    if (!candidate.token) return false;
    const cat = typeof candidate.token.category === 'string' ? candidate.token.category : toHex(candidate.token.category);
    return cat === category;
  });
  if (!found) throw new Error(`covenant UTXO for category ${category} not found`);
  return found;
}

describe('facts emitted by indexRawTransaction satisfy the schema', () => {
  it('validates a vault identity genesis', async () => {
    const owner = makeParty(seedCounter + 1);
    seedCounter += 1;
    const contract = new Contract(vaultArtifact, [owner.pkh], { provider });
    const utxo = mockUtxo('dd'.repeat(32), 10_000n);
    provider.addUtxo(contract.address, utxo);

    const tx = await new TransactionBuilder({ provider })
      .addInput(utxo, unlocker(contract, 'mint').mint!(owner.publicKey, new SignatureTemplate(owner.privateKey), 1000n))
      .addOutput({
        to: contract.tokenAddress,
        amount: 1000n,
        token: { category: utxo.txid, amount: 0n, nft: { capability: 'none', commitment: owner.pkhHex } },
      })
      .addBchChangeOutputIfNeeded({ to: owner.address, feeRate: 1 })
      .send();

    const fact = indexRawTransaction(tx.hex, createMemoryStore());
    expect(check(fact)).toEqual([]);
  });

  it('validates a legacy identity genesis', async () => {
    const owner = makeParty(seedCounter + 1);
    seedCounter += 1;
    const contract = new Contract(identityArtifact, [owner.pkh], { provider });
    const utxo = mockUtxo('ee'.repeat(32), 10_000n);
    provider.addUtxo(contract.address, utxo);

    const tx = await new TransactionBuilder({ provider })
      .addInput(utxo, unlocker(contract, 'mint').mint!())
      .addOutput({
        to: owner.address,
        amount: 1000n,
        token: { category: utxo.txid, amount: 0n, nft: { capability: 'none', commitment: '' } },
      })
      .addOutput({ to: owner.address, amount: 8000n })
      .send();

    const fact = indexRawTransaction(tx.hex, createMemoryStore());
    expect(check(fact)).toEqual([]);
  });

  it('validates a receipt genesis, both ratings, a confirmation and a trust link', async () => {
    const partyA: Party = makeParty(seedCounter + 1);
    const partyB: Party = makeParty(seedCounter + 2);
    seedCounter += 2;

    const contract = new Contract(receiptArtifact, receiptGenesisArgs(partyA, partyB), { provider });
    const { vaultForA, vaultForB } = receiptRights(provider, partyA, partyB);
    const utxo = mockUtxo('aa'.repeat(32), 10_000n);
    provider.addUtxo(contract.address, utxo);
    const category = utxo.txid;

    const receiptTx = await new TransactionBuilder({ provider })
      .addInput(
        utxo,
        unlocker(contract, 'mint').mint!(
          partyA.publicKey,
          new SignatureTemplate(partyA.privateKey),
          partyB.publicKey,
          new SignatureTemplate(partyB.privateKey),
        ),
      )
      .addOutput({
        to: partyA.address,
        amount: 1000n,
        token: { category, amount: 0n, nft: { capability: 'none', commitment: '' } },
      })
      .addOutput({
        to: vaultForA.tokenAddress,
        amount: 1000n,
        token: { category, amount: 0n, nft: { capability: 'none', commitment: partyB.pkhHex } },
      })
      .addOutput({
        to: vaultForB.tokenAddress,
        amount: 1000n,
        token: { category, amount: 0n, nft: { capability: 'none', commitment: partyA.pkhHex } },
      })
      .addOutput({ to: partyA.address, amount: 6000n })
      .send();

    const store = createMemoryStore();
    const receiptFact = indexRawTransaction(receiptTx.hex, store);
    expect(check(receiptFact)).toEqual([]);

    // An in-range rating.
    const ratingUtxo = {
      txid: receiptTx.txid,
      vout: 1,
      satoshis: 1000n,
      token: { category: receiptTx.txid, amount: 0n, nft: { capability: 'none' as const, commitment: partyB.pkhHex } },
    };
    provider.addUtxo(partyA.address, ratingUtxo);
    const fee1 = mockUtxo('cc'.repeat(32), 50_000n);
    provider.addUtxo(partyA.address, fee1);
    const ratingTx = await new TransactionBuilder({ provider })
      .addInput(ratingUtxo, new SignatureTemplate(partyA.privateKey).unlockP2PKH())
      .addInput(fee1, new SignatureTemplate(partyA.privateKey).unlockP2PKH())
      .addOutput(ratingOpReturnOutput(4))
      .addOutput({ to: partyA.address, amount: 40_000n })
      .send();
    expect(check(indexRawTransaction(ratingTx.hex, store))).toEqual([]);

    // An out-of-range rating: still emitted, marked invalid, still valid per schema.
    const badUtxo = {
      txid: receiptTx.txid,
      vout: 2,
      satoshis: 1000n,
      token: { category: receiptTx.txid, amount: 0n, nft: { capability: 'none' as const, commitment: partyA.pkhHex } },
    };
    provider.addUtxo(partyB.address, badUtxo);
    const fee2 = mockUtxo('cd'.repeat(32), 50_000n);
    provider.addUtxo(partyB.address, fee2);
    const badTx = await new TransactionBuilder({ provider })
      .addInput(badUtxo, new SignatureTemplate(partyB.privateKey).unlockP2PKH())
      .addInput(fee2, new SignatureTemplate(partyB.privateKey).unlockP2PKH())
      .addOutput(ratingOpReturnOutput(99))
      .addOutput({ to: partyB.address, amount: 40_000n })
      .send();
    const badFact = indexRawTransaction(badTx.hex, store);
    expect(check(badFact)).toEqual([]);
    expect((badFact as { valid: boolean }).valid).toBe(false);

    // A platform confirmation referencing the indexed Receipt.
    const platform = makeParty(seedCounter + 1);
    seedCounter += 1;
    const platUtxo = mockUtxo('ce'.repeat(32), 50_000n);
    provider.addUtxo(platform.address, platUtxo);
    const confirmTx = await new TransactionBuilder({ provider })
      .addInput(platUtxo, new SignatureTemplate(platform.privateKey).unlockP2PKH())
      .addOutput(platformOpReturnOutput(receiptTx.txid))
      .addOutput({ to: platform.address, amount: 40_000n })
      .send();
    expect(check(indexRawTransaction(confirmTx.hex, store))).toEqual([]);

    // A trust link.
    const truster = makeParty(seedCounter + 1);
    const trusted = makeParty(seedCounter + 2);
    seedCounter += 2;
    const trustUtxo = mockUtxo('cf'.repeat(32), 50_000n);
    provider.addUtxo(truster.address, trustUtxo);
    const trustTx = await new TransactionBuilder({ provider })
      .addInput(trustUtxo, new SignatureTemplate(truster.privateKey).unlockP2PKH())
      .addOutput(trustOpReturnOutput(trusted.pkhHex))
      .addOutput({ to: truster.address, amount: 40_000n })
      .send();
    expect(check(indexRawTransaction(trustTx.hex, store))).toEqual([]);
  });

  it('validates a collateral top-up and a burn on top of a real vault identity', async () => {
    // The genesis alone does not exercise the two vault facts that are only
    // emitted on a later spend. They carry `collateral` as a decimal string, which
    // is exactly the kind of representation detail a schema is supposed to pin
    // down, so a hand-written object would not have proved much.
    const owner = makeParty(seedCounter + 1);
    seedCounter += 1;
    const contract = new Contract(vaultArtifact, [owner.pkh], { provider });
    const funding = mockUtxo('dd'.repeat(32), 10_000n);
    provider.addUtxo(contract.address, funding);
    const category = funding.txid;

    const genesis = await new TransactionBuilder({ provider })
      .addInput(funding, unlocker(contract, 'mint').mint!(owner.publicKey, new SignatureTemplate(owner.privateKey), 1000n))
      .addOutput({
        to: contract.tokenAddress,
        amount: 1000n,
        token: { category, amount: 0n, nft: { capability: 'none', commitment: owner.pkhHex } },
      })
      .addBchChangeOutputIfNeeded({ to: owner.address, feeRate: 1 })
      .send();

    const store = createMemoryStore();
    expect(check(indexRawTransaction(genesis.hex, store))).toEqual([]);

    const covenant = await findCovenantUtxo(contract, category);

    const topUpFee = mockUtxo('b1'.repeat(32), 5_000n);
    provider.addUtxo(owner.address, topUpFee);
    const topUpTx = await new TransactionBuilder({ provider })
      .addInput(
        covenant,
        unlocker(contract, 'increaseCollateral').increaseCollateral!(owner.publicKey, new SignatureTemplate(owner.privateKey)),
      )
      .addInput(topUpFee, new SignatureTemplate(owner.privateKey).unlockP2PKH())
      .addOutput({
        to: contract.tokenAddress,
        amount: 2500n,
        token: { category, amount: 0n, nft: { capability: 'none', commitment: owner.pkhHex } },
      })
      .addBchChangeOutputIfNeeded({ to: owner.address, feeRate: 1 })
      .send();

    const topUpFact = indexRawTransaction(topUpTx.hex, store);
    expect((topUpFact as { type: string }).type).toBe('IDENTITY_COLLATERAL_TOP_UP');
    expect(check(topUpFact)).toEqual([]);

    const burnedCovenant = await findCovenantUtxo(contract, category);
    const burnFee = mockUtxo('b2'.repeat(32), 5_000n);
    provider.addUtxo(owner.address, burnFee);
    const burnTx = await new TransactionBuilder({ provider })
      .addInput(burnedCovenant, unlocker(contract, 'burn').burn!(owner.publicKey, new SignatureTemplate(owner.privateKey)))
      .addInput(burnFee, new SignatureTemplate(owner.privateKey).unlockP2PKH())
      .addOutput({ to: owner.address, amount: 2500n })
      .addBchChangeOutputIfNeeded({ to: owner.address, feeRate: 1 })
      .send();

    const burnFact = indexRawTransaction(burnTx.hex, store);
    expect((burnFact as { type: string }).type).toBe('IDENTITY_BURNED');
    expect(check(burnFact)).toEqual([]);
  });

  it('keeps the OP_RETURN tags the recognizer uses in step with the constants file', () => {
    // If a tag in constants.json were ever changed without a spec change, the
    // recognizer and the protocol would silently disagree. The tags are the
    // protocol's only on-chain marker, so they are worth asserting explicitly.
    expect(OP_RETURN_TAGS.RATING).toBe('REPID_RATING1');
    expect(OP_RETURN_TAGS.RATING2).toBe('REPID_RATING2');
    expect(OP_RETURN_TAGS.RETRACT).toBe('REPID_RETRACT1');
    expect(OP_RETURN_TAGS.PLATFORM).toBe('REPID_PLATFORM1');
    expect(OP_RETURN_TAGS.TRUST).toBe('REPID_TRUST1');
  });
});
