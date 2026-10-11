import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Contract, MockNetworkProvider, TransactionBuilder, SignatureTemplate } from 'cashscript';
import { binToHex } from '@bitauth/libauth';
import { indexRawTransaction, createMemoryStore } from '../src/index.js';
import { createJsonFileStore } from '../src/node/index.js';
import receiptArtifact from './fixtures/receipt_genesis.json' with { type: 'json' };
import {
  makeParty,
  makeProvider,
  mockUtxo,
  platformOpReturnOutput,
  foreignTagOpReturnOutput,
  expectFact,
  unlocker,
  receiptGenesisArgs,
  receiptRights,
} from './helpers.js';

// --- PLATFORM_CONFIRMATION (SPEC-003 RF-06, pattern C) --------------------

const provider: MockNetworkProvider = makeProvider();
let seedCounter = 100;

beforeEach(() => {
  provider.reset();
  seedCounter = 100;
});

/** Mints a Receipt and indexes it in `store`. */
async function genesisAndIndexReceipt(store: ReturnType<typeof createMemoryStore>) {
  const partyA = makeParty(seedCounter + 1);
  const partyB = makeParty(seedCounter + 2);
  seedCounter += 2;

  const contract = new Contract(receiptArtifact, receiptGenesisArgs(partyA, partyB), { provider });
  const { vaultForA, vaultForB } = receiptRights(provider, partyA, partyB);
  const utxo = mockUtxo('bb'.repeat(32), 10_000n);
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

  const fact = expectFact(indexRawTransaction(tx.hex, store), 'RECEIPT_GENESIS');
  return { fact, tx, partyA, partyB };
}

/** Normal funds so the platform can spend a P2PKH UTXO and pay the fee. */
function fundPlatformUtxo(owner: ReturnType<typeof makeParty>) {
  const utxo = mockUtxo('cc'.repeat(32), 50_000n);
  provider.addUtxo(owner.address, utxo);
  return utxo;
}

describe('PLATFORM_CONFIRMATION', () => {
  it('recognizes a platform attestation that references an already indexed Receipt', async () => {
    const store = createMemoryStore();
    const { fact: receiptFact } = await genesisAndIndexReceipt(store);

    // The platform spends its own P2PKH UTXO with the OP_RETURN referencing the
    // Receipt txid. It needs no Identity of its own, which is what lets a
    // platform corroborate without participating in the interaction.
    const platform = makeParty(seedCounter + 1);
    seedCounter += 1;
    const feeUtxo = fundPlatformUtxo(platform);

    const tx = await new TransactionBuilder({ provider })
      .addInput(feeUtxo, new SignatureTemplate(platform.privateKey).unlockP2PKH())
      .addOutput(platformOpReturnOutput(receiptFact.txid))
      .addOutput({ to: platform.address, amount: 40_000n })
      .send();

    const fact = expectFact(indexRawTransaction(tx.hex, store), 'PLATFORM_CONFIRMATION');
    expect(fact.receiptTxid).toBe(receiptFact.txid);
    expect(fact.platformPkh).toBe(binToHex(platform.pkh));
    expect(fact.valid).toBe(true);
  });

  it('marks as invalid a confirmation that references an unknown Receipt', async () => {
    const store = createMemoryStore();

    const platform = makeParty(seedCounter + 1);
    seedCounter += 1;
    const feeUtxo = fundPlatformUtxo(platform);

    const fakeReceiptTxid = 'ab'.repeat(32);
    const tx = await new TransactionBuilder({ provider })
      .addInput(feeUtxo, new SignatureTemplate(platform.privateKey).unlockP2PKH())
      .addOutput(platformOpReturnOutput(fakeReceiptTxid))
      .addOutput({ to: platform.address, amount: 40_000n })
      .send();

    const fact = expectFact(indexRawTransaction(tx.hex, store), 'PLATFORM_CONFIRMATION');

    // Recognized, not silently ignored, but the reference points to a Receipt
    // this recognizer never saw, so it cannot corroborate the claim.
    expect(fact.receiptTxid).toBe(fakeReceiptTxid);
    expect(fact.valid).toBe(false);
  });

  it('does not recognize an OP_RETURN with a tag foreign to RepID', async () => {
    const store = createMemoryStore();
    await genesisAndIndexReceipt(store);

    const platform = makeParty(seedCounter + 1);
    seedCounter += 1;
    const feeUtxo = fundPlatformUtxo(platform);

    const tx = await new TransactionBuilder({ provider })
      .addInput(feeUtxo, new SignatureTemplate(platform.privateKey).unlockP2PKH())
      .addOutput(foreignTagOpReturnOutput('NOTREPID5'))
      .addOutput({ to: platform.address, amount: 40_000n })
      .send();

    expect(indexRawTransaction(tx.hex, store)).toBeNull();
  });
});

describe('persisted Receipt index', () => {
  it('persists the Receipt index and reloads it in a new store instance', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'repid-receipts-'));
    const filePath = join(dir, 'store.json');
    try {
      const store1 = createJsonFileStore(filePath);
      const { fact } = await genesisAndIndexReceipt(store1);

      const store2 = createJsonFileStore(filePath);
      expect(store2.getReceipt(fact.txid)).toMatchObject({
        receiptOwnerPkh: fact.receiptOwnerPkh,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
