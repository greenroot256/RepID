// A Rating Right is single-use. The NFT is burned by being spent, and the
// spent outpoint must stop being recognizable as a rateable right.
//
// The gap these tests close: the previous implementation only ever *read* the
// retained Rating Rights. `untrackIdentity` existed for burned identities, but
// nothing retired a Rating Right, so an indexer would attribute a second rating
// to the same right. None of the 23 ported tests caught it, because they all
// asked "is this recognized?" and none asked "is the right still available?".
//
// This is a real conformance fix, not a refactor: SPEC-005 makes retaining
// Rating Right outpoints normative precisely so a rating can be attributed
// once and only once.

import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Contract, MockNetworkProvider, TransactionBuilder, SignatureTemplate, type Utxo } from 'cashscript';
import { indexRawTransaction, createMemoryStore } from '../src/index.js';
import { createJsonFileStore } from '../src/node/index.js';
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

const provider: MockNetworkProvider = makeProvider();
let seedCounter = 0;

beforeEach(() => {
  provider.reset();
  seedCounter = 0;
});

async function genesisReceipt() {
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
  const fact = expectFact(indexRawTransaction(tx.hex, store), 'RECEIPT_GENESIS');
  return { partyA, partyB, tx, store, receipt: fact };
}

/** Builds a rating transaction spending the given Rating Right outpoint. */
async function spendRatingRight(
  partyA: Party,
  partyB: Party,
  receiptTxid: string,
  score: number,
  feeSeed: string,
): Promise<{ hex: string; txid: string }> {
  const ratingRightUtxo: Utxo = {
    txid: receiptTxid,
    vout: 1,
    satoshis: 1000n,
    token: {
      category: receiptTxid,
      amount: 0n,
      nft: { capability: 'none', commitment: partyB.pkhHex },
    },
  };
  provider.addUtxo(partyA.address, ratingRightUtxo);
  const feeUtxo = mockUtxo(feeSeed.repeat(32), 50_000n);
  provider.addUtxo(partyA.address, feeUtxo);

  const tx = await new TransactionBuilder({ provider })
    .addInput(ratingRightUtxo, new SignatureTemplate(partyA.privateKey).unlockP2PKH())
    .addInput(feeUtxo, new SignatureTemplate(partyA.privateKey).unlockP2PKH())
    .addOutput(ratingOpReturnOutput(score))
    .addOutput({ to: partyA.address, amount: 40_000n })
    .send();

  return { hex: tx.hex, txid: tx.txid };
}

describe('Rating Right consumption', () => {
  it('retires the Rating Right when it is spent', async () => {
    const { partyA, partyB, tx: receiptTx, store, receipt } = await genesisReceipt();
    const outpoint = receipt.ratingRights[0]!.outpoint;

    expect(store.getRatingRight(outpoint)).toBeTruthy();

    const rating = await spendRatingRight(partyA, partyB, receiptTx.txid, 5, 'cc');
    expectFact(indexRawTransaction(rating.hex, store), 'RATING_ISSUED');

    // The right is gone from the retained state: it was burned on chain.
    expect(store.getRatingRight(outpoint)).toBeUndefined();
  });

  it('does not attribute a second rating to the same Rating Right', async () => {
    const { partyA, partyB, tx: receiptTx, store, receipt } = await genesisReceipt();
    const outpoint = receipt.ratingRights[0]!.outpoint;

    const first = await spendRatingRight(partyA, partyB, receiptTx.txid, 5, 'cc');
    expectFact(indexRawTransaction(first.hex, store), 'RATING_ISSUED');

    // A second transaction claiming to spend the same outpoint. It cannot be
    // mined, because the UTXO is already spent -- but an indexer fed arbitrary
    // hex must not report it as a second rating by the same party.
    const second = await spendRatingRight(partyA, partyB, receiptTx.txid, 1, 'dd');

    expect(indexRawTransaction(second.hex, store)).toBeNull();
  });

  it('retires the Rating Right even when the score is out of range', async () => {
    const { partyA, partyB, tx: receiptTx, store, receipt } = await genesisReceipt();
    const outpoint = receipt.ratingRights[0]!.outpoint;

    // An out-of-range score is an invalid rating, but the NFT was still burned.
    // Retirement describes the chain, not the validity, so it must happen.
    const rating = await spendRatingRight(partyA, partyB, receiptTx.txid, 200, 'cc');
    const fact = expectFact(indexRawTransaction(rating.hex, store), 'RATING_ISSUED');
    expect(fact.valid).toBe(false);

    expect(store.getRatingRight(outpoint)).toBeUndefined();
  });

  it('leaves the other party’s Rating Right untouched', async () => {
    const { partyA, partyB, tx: receiptTx, store, receipt } = await genesisReceipt();
    const [rightA, rightB] = receipt.ratingRights;

    const rating = await spendRatingRight(partyA, partyB, receiptTx.txid, 5, 'cc');
    expectFact(indexRawTransaction(rating.hex, store), 'RATING_ISSUED');

    // Each party gets its own right; spending one must not consume the other.
    expect(store.getRatingRight(rightA!.outpoint)).toBeUndefined();
    expect(store.getRatingRight(rightB!.outpoint)).toBeTruthy();
  });

  it('persists the retirement, so a restart cannot resurrect a spent right', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'repid-consume-'));
    const filePath = join(dir, 'store.json');
    try {
      const { partyA, partyB, tx: receiptTx, receipt } = await genesisReceipt();
      const store1 = createJsonFileStore(filePath);
      indexRawTransaction(receiptTx.hex, store1);
      const outpoint = receipt.ratingRights[0]!.outpoint;

      const rating = await spendRatingRight(partyA, partyB, receiptTx.txid, 5, 'cc');
      expectFact(indexRawTransaction(rating.hex, store1), 'RATING_ISSUED');

      // The retirement is on disk, not just in memory.
      const onDisk = JSON.parse(readFileSync(filePath, 'utf8'));
      expect(onDisk.ratingRights[outpoint]).toBeUndefined();

      // A new store over the same file agrees.
      const store2 = createJsonFileStore(filePath);
      expect(store2.getRatingRight(outpoint)).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
