import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Contract,
  MockNetworkProvider,
  TransactionBuilder,
  SignatureTemplate,
} from 'cashscript';
import {
  generatePrivateKey, secp256k1, hash160, lockingBytecodeToCashAddress, binToHex, utf8ToBin,
} from '@bitauth/libauth';
import receiptArtifact from './fixtures/receipt_genesis.json' with { type: 'json' };
import { indexRawTransaction, createMemoryStore, createJsonFileStore } from '@repid/indexer';
import { REPID_PLATFORM_TAG } from '@repid/protocol';

// --- Helpers -------------------------------------------------------------

const provider = new MockNetworkProvider();

let seedCounter = 100;
function makeParty() {
  seedCounter += 1;
  const privateKey = generatePrivateKey(() => new Uint8Array(32).fill(seedCounter));
  const publicKey = secp256k1.derivePublicKeyCompressed(privateKey);
  const pkh = hash160(publicKey);
  const p2pkhBytecode = new Uint8Array([0x76, 0xa9, 0x14, ...pkh, 0x88, 0xac]);
  const addressResult = lockingBytecodeToCashAddress({
    bytecode: p2pkhBytecode, prefix: 'bchtest', tokenSupport: true,
  });
  if (typeof addressResult === 'string') throw new Error(addressResult);
  return { privateKey, publicKey, pkh, address: addressResult.address };
}

// Builds the OP_RETURN output of a PLATFORM_CONFIRMATION (SPEC-003
// RF-06): OP_RETURN <tag> <Receipt txid (32 bytes)>.
function platformOpReturnOutput(receiptTxidHex) {
  const tagBytes = utf8ToBin(REPID_PLATFORM_TAG);
  const txidBytes = hexToBytes(receiptTxidHex);
  const bytecode = new Uint8Array([
    0x6a, tagBytes.length, ...tagBytes, txidBytes.length, ...txidBytes,
  ]);
  return { to: bytecode, amount: 0n };
}

// Registers a Receipt and leaves it indexed in `store` (the indexer also
// records it so the confirmation can reference it).
async function genesisAndIndexReceipt(store) {
  const partyA = makeParty();
  const partyB = makeParty();
  const contract = new Contract(receiptArtifact, [partyA.pkh, partyB.pkh], { provider });
  const utxo = { txid: 'bb'.repeat(32), vout: 0, satoshis: 10_000n };
  provider.addUtxo(contract.address, utxo);
  const category = utxo.txid;

  const tx = await new TransactionBuilder({ provider })
    .addInput(
      utxo,
      contract.unlock.mint(
        partyA.publicKey,
        new SignatureTemplate(partyA.privateKey),
        partyB.publicKey,
        new SignatureTemplate(partyB.privateKey),
      ),
    )
    .addOutput({ to: partyA.address, amount: 1000n, token: { category, amount: 0n, nft: { capability: 'none', commitment: '' } } })
    .addOutput({ to: partyA.address, amount: 1000n, token: { category, amount: 0n, nft: { capability: 'none', commitment: binToHex(partyB.pkh) } } })
    .addOutput({ to: partyB.address, amount: 1000n, token: { category, amount: 0n, nft: { capability: 'none', commitment: binToHex(partyA.pkh) } } })
    .addOutput({ to: partyA.address, amount: 6000n })
    .send();

  const fact = indexRawTransaction(tx.hex, store);
  if (fact.type !== 'RECEIPT_GENESIS') throw new Error('Could not generate the test Receipt');
  return { fact, tx, partyA, partyB };
}

// Gives `owner` a normal-funds UTXO so the platform can spend it as an
// attestation (P2PKH) and pay the fee.
function fundPlatformUtxo(owner, satoshis = 50_000n) {
  const utxo = { txid: 'cc'.repeat(32), vout: 0, satoshis };
  provider.addUtxo(owner.address, utxo);
  return utxo;
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

beforeEach(() => {
  provider.reset();
  seedCounter = 100;
});

// --- Tests: PLATFORM_CONFIRMATION (SPEC-003 RF-06, pattern C) -------------

describe('PLATFORM_CONFIRMATION', () => {
  it('recognizes a platform attestation that references an already indexed Receipt', async () => {
    const store = createMemoryStore();
    const { fact: receiptFact } = await genesisAndIndexReceipt(store);

// The platform (C) spends its own P2PKH UTXO with the OP_RETURN that
// references the Receipt txid. It needs no Identity of its own.
    const platform = makeParty();
    const feeUtxo = fundPlatformUtxo(platform);

    const tx = await new TransactionBuilder({ provider })
      .addInput(feeUtxo, new SignatureTemplate(platform.privateKey).unlockP2PKH())
      .addOutput(platformOpReturnOutput(receiptFact.txid))
      .addOutput({ to: platform.address, amount: 40_000n })
      .send();

    const fact = indexRawTransaction(tx.hex, store);

    expect(fact.type).toBe('PLATFORM_CONFIRMATION');
    expect(fact.receiptTxid).toBe(receiptFact.txid);
    expect(fact.platformPkh).toBe(binToHex(platform.pkh));
    expect(fact.valid).toBe(true);
  });

  it('marks as invalid a confirmation that references an unknown Receipt', async () => {
    const store = createMemoryStore();

    const platform = makeParty();
    const feeUtxo = fundPlatformUtxo(platform);

    const fakeReceiptTxid = 'ab'.repeat(32);
    const tx = await new TransactionBuilder({ provider })
      .addInput(feeUtxo, new SignatureTemplate(platform.privateKey).unlockP2PKH())
      .addOutput(platformOpReturnOutput(fakeReceiptTxid))
      .addOutput({ to: platform.address, amount: 40_000n })
      .send();

    const fact = indexRawTransaction(tx.hex, store);

// The pattern is recognized (not silently ignored) but the reference
// points to a Receipt the indexer never saw => invalid interpretation.
    expect(fact.type).toBe('PLATFORM_CONFIRMATION');
    expect(fact.receiptTxid).toBe(fakeReceiptTxid);
    expect(fact.valid).toBe(false);
  });

  it('does not recognize an OP_RETURN with a tag foreign to RepID', async () => {
    const store = createMemoryStore();
    await genesisAndIndexReceipt(store);

    const platform = makeParty();
    const feeUtxo = fundPlatformUtxo(platform);

    const alienBytes = utf8ToBin('NOTREPID5');
    const bytecode = new Uint8Array([0x6a, alienBytes.length, ...alienBytes]);
    const tx = await new TransactionBuilder({ provider })
      .addInput(feeUtxo, new SignatureTemplate(platform.privateKey).unlockP2PKH())
      .addOutput({ to: bytecode, amount: 0n })
      .addOutput({ to: platform.address, amount: 40_000n })
      .send();

    expect(indexRawTransaction(tx.hex, store)).toBeNull();
  });
});

// --- Tests: Receipt index persistence (TASK-016) ------------------------

describe('Indexer — persisted receipts (TASK-016)', () => {
  it('persists the Receipt index and reloads it in a new store instance', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'repid-receipts-'));
    const filePath = join(dir, 'store.json');
    try {
      const store1 = createJsonFileStore(filePath);
      const { fact } = await genesisAndIndexReceipt(store1);
      expect(fact.type).toBe('RECEIPT_GENESIS');

      const store2 = createJsonFileStore(filePath);
      expect(store2.getReceipt(fact.txid)).toMatchObject({
        receiptOwnerPkh: fact.receiptOwnerPkh,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});