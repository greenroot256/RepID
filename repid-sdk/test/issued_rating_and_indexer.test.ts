import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Contract,
  MockNetworkProvider,
  TransactionBuilder,
  SignatureTemplate,
  type Utxo,
} from 'cashscript';
import { binToHex } from '@bitauth/libauth';
import { indexRawTransaction, createMemoryStore } from '../src/index.js';
import { createJsonFileStore } from '../src/node/index.js';
import { hexToBytes, toHex } from '../src/bytes.js';
import identityArtifact from './fixtures/identity_genesis.json' with { type: 'json' };
import receiptArtifact from './fixtures/receipt_genesis.json' with { type: 'json' };
import {
  makeParty,
  makeProvider,
  mockUtxo,
  ratingOpReturnOutput,
  expectFact,
  unlocker,
  type Party,
  receiptGenesisArgs,
  receiptRights,
} from './helpers.js';

// --- ISSUED_RATING and indexer (SPEC-004, SPEC-001, SPEC-003) -------------

const provider: MockNetworkProvider = makeProvider();
let seedCounter = 0;

beforeEach(() => {
  provider.reset();
  seedCounter = 0;
});

/**
 * Mints a Receipt with both parties' signatures and returns it, so the Rating
 * Rights at outputs 1 and 2 can be spent afterwards. Identities are omitted
 * because a rating only depends on the Receipt.
 */
async function genesisReceipt(): Promise<{
  partyA: Party;
  partyB: Party;
  tx: { hex: string; txid: string };
}> {
  const partyA = makeParty(seedCounter + 1);
  const partyB = makeParty(seedCounter + 2);
  seedCounter += 2;

  const contract = new Contract(receiptArtifact, receiptGenesisArgs(partyA, partyB), { provider });
  const { vaultForA, vaultForB } = receiptRights(provider, partyA, partyB);
  const utxo = mockUtxo('aa'.repeat(32), 10_000n);
  provider.addUtxo(contract.address, utxo);
  const category = utxo.txid;

  const tx = await new TransactionBuilder({ provider })
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
      token: {
        category,
        amount: 0n,
        nft: { capability: 'none', commitment: binToHex(partyB.pkh) },
      },
    })
    .addOutput({
      to: vaultForB.tokenAddress,
      amount: 1000n,
      token: {
        category,
        amount: 0n,
        nft: { capability: 'none', commitment: binToHex(partyA.pkh) },
      },
    })
    .addOutput({ to: partyA.address, amount: 6000n })
    .send();

  return { partyA, partyB, tx };
}

/** Normal funds for a P2PKH spend that pays the fee. */
function fundFeeUtxo(owner: Party): Utxo {
  const utxo = mockUtxo('cc'.repeat(32), 50_000n);
  provider.addUtxo(owner.address, utxo);
  return utxo;
}

describe('ISSUED_RATING', () => {
  it('spends the Rating Right with a score OP_RETURN and burns the NFT (without re-issuing it)', async () => {
    const { partyA, partyB, tx: receiptTx } = await genesisReceipt();

    // partyA's Rating Right sits at output 1 of the genesis transaction, and its
    // commitment names partyB as the party it is entitled to rate.
    const ratingRightUtxo: Utxo = {
      txid: receiptTx.txid,
      vout: 1,
      satoshis: 1000n,
      token: {
        category: receiptTx.txid,
        amount: 0n,
        nft: { capability: 'none', commitment: partyB.pkhHex },
      },
    };
    provider.addUtxo(partyA.address, ratingRightUtxo);
    const feeUtxo = fundFeeUtxo(partyA);

    const tx = await new TransactionBuilder({ provider })
      .addInput(ratingRightUtxo, new SignatureTemplate(partyA.privateKey).unlockP2PKH())
      .addInput(feeUtxo, new SignatureTemplate(partyA.privateKey).unlockP2PKH())
      .addOutput(ratingOpReturnOutput(5))
      .addOutput({ to: partyA.address, amount: 40_000n }) // change, no token: implicit burn
      .send();

    expect(tx.txid).toBeTruthy();
    // The NFT appears in no output => implicitly burned.
    expect(tx.outputs.every((o) => !o.token)).toBe(true);
  });
});

describe('Indexer: identity, receipt and rating recognition', () => {
  it('recognizes an IDENTITY_GENESIS and extracts category + owner', async () => {
    const owner = makeParty(seedCounter + 1);
    seedCounter += 1;
    const contract = new Contract(identityArtifact, [owner.pkh], { provider });
    const utxo = mockUtxo('dd'.repeat(32), 10_000n);
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

    const fact = expectFact(
      indexRawTransaction(tx.hex, createMemoryStore()),
      'IDENTITY_GENESIS',
    );
    expect(fact.ownerPkh).toBe(binToHex(owner.pkh));
    // The mock UTXO txid is already display order; the recognizer must not
    // invert it, which is the byte-order mistake this comparison exists to catch.
    expect(fact.identityCategory).toBe(toHex(hexToBytes(utxo.txid)));
  });

  it('recognizes an IDENTITY_GENESIS alongside the change output', async () => {
    const owner = makeParty(seedCounter + 1);
    seedCounter += 1;
    const contract = new Contract(identityArtifact, [owner.pkh], { provider });
    const utxo = mockUtxo('dd'.repeat(32), 10_000n);
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

    const fact = expectFact(
      indexRawTransaction(tx.hex, createMemoryStore()),
      'IDENTITY_GENESIS',
    );
    expect(fact.ownerPkh).toBe(binToHex(owner.pkh));
  });

  it('recognizes a RECEIPT_GENESIS and registers both Rating Rights for tracking', async () => {
    const { partyA, partyB, tx } = await genesisReceipt();

    const store = createMemoryStore();
    const fact = expectFact(indexRawTransaction(tx.hex, store), 'RECEIPT_GENESIS');

    expect(fact.ratingRights).toHaveLength(2);
    expect(fact.ratingRights[0]).toMatchObject({
      ownerPkh: binToHex(partyA.pkh),
      ratesPkh: binToHex(partyB.pkh),
    });
    expect(fact.ratingRights[1]).toMatchObject({
      ownerPkh: binToHex(partyB.pkh),
      ratesPkh: binToHex(partyA.pkh),
    });

    // The Rating Rights stay tracked by outpoint so they can be found when spent.
    expect(store.getRatingRight(fact.ratingRights[0]!.outpoint)).toBeTruthy();
  });

  it('recognizes a RECEIPT_GENESIS alongside the change output', async () => {
    const partyA = makeParty(seedCounter + 1);
    const partyB = makeParty(seedCounter + 2);
    seedCounter += 2;
    const contract = new Contract(receiptArtifact, receiptGenesisArgs(partyA, partyB), { provider });
  const { vaultForA, vaultForB } = receiptRights(provider, partyA, partyB);
    const utxo = mockUtxo('aa'.repeat(32), 10_000n);
    provider.addUtxo(contract.address, utxo);
    const category = utxo.txid;

    const tx = await new TransactionBuilder({ provider })
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
        token: {
        category,
        amount: 0n,
        nft: { capability: 'none', commitment: binToHex(partyB.pkh) },
      },
      })
      .addOutput({
        to: vaultForB.tokenAddress,
        amount: 1000n,
        token: {
        category,
        amount: 0n,
        nft: { capability: 'none', commitment: binToHex(partyA.pkh) },
      },
      })
      .addOutput({ to: partyA.address, amount: 6000n })
      .send();

    const store = createMemoryStore();
    const fact = expectFact(indexRawTransaction(tx.hex, store), 'RECEIPT_GENESIS');

    expect(fact.ratingRights).toHaveLength(2);
    expect(fact.ratingRights[0]).toMatchObject({
      ownerPkh: binToHex(partyA.pkh),
      ratesPkh: binToHex(partyB.pkh),
    });
    expect(store.getRatingRight(fact.ratingRights[0]!.outpoint)).toBeTruthy();
  });

  it('recognizes a RATING_ISSUED by crossing it with the already indexed Rating Right', async () => {
    const { partyA, partyB, tx: receiptTx } = await genesisReceipt();

    const store = createMemoryStore();
    // Index the genesis first, as a real indexer would.
    expectFact(indexRawTransaction(receiptTx.hex, store), 'RECEIPT_GENESIS');

    const ratingRightUtxo: Utxo = {
      txid: receiptTx.txid,
      vout: 1,
      satoshis: 1000n,
      token: {
        category: receiptTx.txid,
        amount: 0n,
        nft: { capability: 'none', commitment: partyB.pkhHex },
      },
    };
    provider.addUtxo(partyA.address, ratingRightUtxo);
    const feeUtxo = fundFeeUtxo(partyA);

    const ratingTx = await new TransactionBuilder({ provider })
      .addInput(ratingRightUtxo, new SignatureTemplate(partyA.privateKey).unlockP2PKH())
      .addInput(feeUtxo, new SignatureTemplate(partyA.privateKey).unlockP2PKH())
      .addOutput(ratingOpReturnOutput(4))
      .addOutput({ to: partyA.address, amount: 40_000n })
      .send();

    const fact = expectFact(indexRawTransaction(ratingTx.hex, store), 'RATING_ISSUED');

    expect(fact.raterPkh).toBe(binToHex(partyA.pkh));
    expect(fact.rateePkh).toBe(binToHex(partyB.pkh));
    expect(fact.score).toBe(4);
    expect(fact.valid).toBe(true);
  });

  it('marks as invalid a RATING_ISSUED whose score is out of the 1-5 range (SPEC-004 RF-04)', async () => {
    for (const outOfRangeScore of [0, 6, 200]) {
      const { partyA, partyB, tx: receiptTx } = await genesisReceipt();

      const store = createMemoryStore();
      expectFact(indexRawTransaction(receiptTx.hex, store), 'RECEIPT_GENESIS');

      const ratingRightUtxo: Utxo = {
        txid: receiptTx.txid,
        vout: 1,
        satoshis: 1000n,
        token: {
          category: receiptTx.txid,
          amount: 0n,
          nft: { capability: 'none', commitment: partyB.pkhHex },
        },
      };
      provider.addUtxo(partyA.address, ratingRightUtxo);
      const feeUtxo = fundFeeUtxo(partyA);

      const ratingTx = await new TransactionBuilder({ provider })
        .addInput(ratingRightUtxo, new SignatureTemplate(partyA.privateKey).unlockP2PKH())
        .addInput(feeUtxo, new SignatureTemplate(partyA.privateKey).unlockP2PKH())
        .addOutput(ratingOpReturnOutput(outOfRangeScore))
        .addOutput({ to: partyA.address, amount: 40_000n })
        .send();

      const fact = expectFact(indexRawTransaction(ratingTx.hex, store), 'RATING_ISSUED');

      // The pattern is recognized, not silently ignored, but marked invalid.
      expect(fact.score).toBe(outOfRangeScore);
      expect(fact.valid).toBe(false);
    }
  });

  it('returns null for a transaction that matches no RepID shape', async () => {
    const someone = makeParty(seedCounter + 1);
    seedCounter += 1;
    const utxo = mockUtxo('ee'.repeat(32), 20_000n);
    provider.addUtxo(someone.address, utxo);

    const tx = await new TransactionBuilder({ provider })
      .addInput(utxo, new SignatureTemplate(someone.privateKey).unlockP2PKH())
      .addOutput({ to: someone.address, amount: 15_000n })
      .send();

    expect(indexRawTransaction(tx.hex, createMemoryStore())).toBeNull();
  });
});

describe('JSON persistence of the retained state', () => {
  it('persists the Rating Rights to disk and reloads them in a new instance', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'repid-store-'));
    const filePath = join(dir, 'store.json');
    try {
      const { tx } = await genesisReceipt();

      const store1 = createJsonFileStore(filePath);
      const fact = expectFact(indexRawTransaction(tx.hex, store1), 'RECEIPT_GENESIS');

      // A second "process" (new store instance, same file) must recover the
      // Rating Rights indexed by the first one.
      const store2 = createJsonFileStore(filePath);
      const rr = fact.ratingRights[0]!;
      expect(store2.getRatingRight(rr.outpoint)).toMatchObject({
        ownerPkh: rr.ownerPkh,
        ratesPkh: rr.ratesPkh,
      });

      const onDisk = JSON.parse(readFileSync(filePath, 'utf8'));
      expect(onDisk.ratingRights).toBeTruthy();
      expect(Object.keys(onDisk.ratingRights)).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('starts clean when the persistence file does not exist (ENOENT)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'repid-store-'));
    const filePath = join(dir, 'store.json');
    try {
      const store = createJsonFileStore(filePath); // must not throw
      expect(store.getRatingRight('abc:0')).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('preserves existing state when the file already contained some', () => {
    const dir = mkdtempSync(join(tmpdir(), 'repid-store-'));
    const filePath = join(dir, 'store.json');
    try {
      writeFileSync(
        filePath,
        JSON.stringify({ ratingRights: { old: { ownerPkh: 'x', ratesPkh: 'y' } } }),
        'utf8',
      );

      const store = createJsonFileStore(filePath);
      store.trackRatingRight('new:0', { ownerPkh: 'a', ratesPkh: 'b' });

      const onDisk = JSON.parse(readFileSync(filePath, 'utf8'));
      expect(onDisk.ratingRights.old).toBeTruthy();
      expect(onDisk.ratingRights['new:0']).toBeTruthy();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
