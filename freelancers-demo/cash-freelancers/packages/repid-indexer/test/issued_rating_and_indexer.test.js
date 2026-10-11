import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
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
import identityArtifact from './fixtures/identity_genesis.json' with { type: 'json' };
import receiptArtifact from './fixtures/receipt_genesis.json' with { type: 'json' };
import { indexRawTransaction, createMemoryStore, createJsonFileStore } from '@repid/indexer';
import { REPID_RATING_TAG } from '@repid/protocol';

// --- Helpers -------------------------------------------------------------

const provider = new MockNetworkProvider();

let seedCounter = 0;
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

// Builds the OP_RETURN output of an ISSUED_RATING: OP_RETURN <tag> <score>
function ratingOpReturnOutput(score) {
  const tagBytes = utf8ToBin(REPID_RATING_TAG);
  const scoreBytes = new Uint8Array([score]);
  const bytecode = new Uint8Array([
    0x6a, tagBytes.length, ...tagBytes, scoreBytes.length, ...scoreBytes,
  ]);
  return { to: bytecode, amount: 0n };
}

// Registers a full interaction (Identity x2 is omitted: the ISSUED_RATING
// MVP only depends on the Receipt) and returns the Rating Rights ready to
// be spent.
async function genesisReceipt() {
  const partyA = makeParty();
  const partyB = makeParty();
  const contract = new Contract(receiptArtifact, [partyA.pkh, partyB.pkh], { provider });
  const utxo = { txid: 'aa'.repeat(32), vout: 0, satoshis: 10_000n };
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

  return { partyA, partyB, tx };
}

// Gives `owner` a second normal-funds UTXO (no token) to cover the fee of
// the ISSUED_RATING transaction.
function fundFeeUtxo(owner, satoshis = 50_000n) {
  const utxo = { txid: 'cc'.repeat(32), vout: 0, satoshis };
  provider.addUtxo(owner.address, utxo);
  return utxo;
}

beforeEach(() => {
  provider.reset();
  seedCounter = 0;
});

// --- Tests: ISSUED_RATING (plain P2PKH spend) ---------------------------

describe('ISSUED_RATING', () => {
  it('spends the Rating Right with a score OP_RETURN and burns the NFT (without re-issuing it)', async () => {
    const { partyA, partyB, tx: receiptTx } = await genesisReceipt();

    // partyA Rating Right sits at output 1 of the genesis tx.
    const ratingRightUtxo = {
      txid: receiptTx.txid,
      vout: 1,
      satoshis: 1000n,
      token: { category: receiptTx.txid, amount: 0n, nft: { capability: 'none', commitment: binToHex(partyB.pkh) } },
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

// --- Tests: indexer (RFC-006) ---------------------------------------------

describe('Indexer RFC-006', () => {
  it('recognizes an IDENTITY_GENESIS and extracts category + owner', async () => {
    const owner = makeParty();
    const contract = new Contract(identityArtifact, [owner.pkh], { provider });
    const utxo = { txid: 'dd'.repeat(32), vout: 0, satoshis: 10_000n };
    provider.addUtxo(contract.address, utxo);

    const tx = await new TransactionBuilder({ provider })
      .addInput(utxo, contract.unlock.mint())
      .addOutput({
        to: owner.address,
        amount: 1000n,
        token: { category: utxo.txid, amount: 0n, nft: { capability: 'none', commitment: '' } },
      })
      .addOutput({ to: owner.address, amount: 8000n })
      .send();

    const store = createMemoryStore();
    const fact = indexRawTransaction(tx.hex, store);

    expect(fact.type).toBe('IDENTITY_GENESIS');
    expect(fact.ownerPkh).toBe(binToHex(owner.pkh));
    expect(fact.identityCategory).toBe(binToHex(hexToBinDisplay(utxo.txid)));
  });

  it('recognizes an IDENTITY_GENESIS alongside the change output (real network)', async () => {
    const owner = makeParty();
    const contract = new Contract(identityArtifact, [owner.pkh], { provider });
    const utxo = { txid: 'dd'.repeat(32), vout: 0, satoshis: 10_000n };
    provider.addUtxo(contract.address, utxo);

    const tx = await new TransactionBuilder({ provider })
      .addInput(utxo, contract.unlock.mint())
      .addOutput({
        to: owner.address,
        amount: 1000n,
        token: { category: utxo.txid, amount: 0n, nft: { capability: 'none', commitment: '' } },
      })
      .addOutput({ to: owner.address, amount: 8000n })
      .send();

    const fact = indexRawTransaction(tx.hex, createMemoryStore());
    expect(fact.type).toBe('IDENTITY_GENESIS');
    expect(fact.ownerPkh).toBe(binToHex(owner.pkh));
  });

  it('recognizes a RECEIPT_GENESIS and registers both Rating Rights for tracking', async () => {
    const { partyA, partyB, tx } = await genesisReceipt();

    const store = createMemoryStore();
    const fact = indexRawTransaction(tx.hex, store);

    expect(fact.type).toBe('RECEIPT_GENESIS');
    expect(fact.ratingRights).toHaveLength(2);
    expect(fact.ratingRights[0]).toMatchObject({ ownerPkh: binToHex(partyA.pkh), ratesPkh: binToHex(partyB.pkh) });
    expect(fact.ratingRights[1]).toMatchObject({ ownerPkh: binToHex(partyB.pkh), ratesPkh: binToHex(partyA.pkh) });

    // The Rating Rights remain tracked by outpoint to be found when spent.
    expect(store.getRatingRight(fact.ratingRights[0].outpoint)).toBeTruthy();
  });

  it('recognizes a RECEIPT_GENESIS alongside the change output (real network)', async () => {
    const partyA = makeParty();
    const partyB = makeParty();
    const contract = new Contract(receiptArtifact, [partyA.pkh, partyB.pkh], { provider });
    const utxo = { txid: 'aa'.repeat(32), vout: 0, satoshis: 10_000n };
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

    const store = createMemoryStore();
    const fact = indexRawTransaction(tx.hex, store);

    expect(fact.type).toBe('RECEIPT_GENESIS');
    expect(fact.ratingRights).toHaveLength(2);
    expect(fact.ratingRights[0]).toMatchObject({ ownerPkh: binToHex(partyA.pkh), ratesPkh: binToHex(partyB.pkh) });
    expect(store.getRatingRight(fact.ratingRights[0].outpoint)).toBeTruthy();
  });

  it('recognizes a RATING_ISSUED by crossing the ISSUED_RATING with the already indexed Rating Right', async () => {
    const { partyA, partyB, tx: receiptTx } = await genesisReceipt();

    const store = createMemoryStore();
    indexRawTransaction(receiptTx.hex, store); // indexes the genesis first, as a real indexer would

    const ratingRightUtxo = {
      txid: receiptTx.txid,
      vout: 1,
      satoshis: 1000n,
      token: { category: receiptTx.txid, amount: 0n, nft: { capability: 'none', commitment: binToHex(partyB.pkh) } },
    };
    provider.addUtxo(partyA.address, ratingRightUtxo);
    const feeUtxo = fundFeeUtxo(partyA);

    const ratingTx = await new TransactionBuilder({ provider })
      .addInput(ratingRightUtxo, new SignatureTemplate(partyA.privateKey).unlockP2PKH())
      .addInput(feeUtxo, new SignatureTemplate(partyA.privateKey).unlockP2PKH())
      .addOutput(ratingOpReturnOutput(4))
      .addOutput({ to: partyA.address, amount: 40_000n })
      .send();

    const fact = indexRawTransaction(ratingTx.hex, store);

    expect(fact.type).toBe('RATING_ISSUED');
    expect(fact.raterPkh).toBe(binToHex(partyA.pkh));
    expect(fact.rateePkh).toBe(binToHex(partyB.pkh));
    expect(fact.score).toBe(4);
    expect(fact.valid).toBe(true);
  });

  it('marks as invalid a RATING_ISSUED whose score is out of the 1-5 range (SPEC-004 RF-04)', async () => {
    for (const outOfRangeScore of [0, 6, 200]) {
      const { partyA, partyB, tx: receiptTx } = await genesisReceipt();

      const store = createMemoryStore();
      indexRawTransaction(receiptTx.hex, store);

      const ratingRightUtxo = {
        txid: receiptTx.txid,
        vout: 1,
        satoshis: 1000n,
        token: { category: receiptTx.txid, amount: 0n, nft: { capability: 'none', commitment: binToHex(partyB.pkh) } },
      };
      provider.addUtxo(partyA.address, ratingRightUtxo);
      const feeUtxo = fundFeeUtxo(partyA);

      const ratingTx = await new TransactionBuilder({ provider })
        .addInput(ratingRightUtxo, new SignatureTemplate(partyA.privateKey).unlockP2PKH())
        .addInput(feeUtxo, new SignatureTemplate(partyA.privateKey).unlockP2PKH())
        .addOutput(ratingOpReturnOutput(outOfRangeScore))
        .addOutput({ to: partyA.address, amount: 40_000n })
        .send();

      const fact = indexRawTransaction(ratingTx.hex, store);

// The pattern is recognized (not silently ignored) but it is marked
// invalid: the transaction is considered invalid (RF-04).
      expect(fact.type).toBe('RATING_ISSUED');
      expect(fact.score).toBe(outOfRangeScore);
      expect(fact.valid).toBe(false);
    }
  });

  it('returns null for a transaction that matches no RepID shape', async () => {
    const someone = makeParty();
    const utxo = { txid: 'ee'.repeat(32), vout: 0, satoshis: 20_000n };
    provider.addUtxo(someone.address, utxo);

    const tx = await new TransactionBuilder({ provider })
      .addInput(utxo, new SignatureTemplate(someone.privateKey).unlockP2PKH())
      .addOutput({ to: someone.address, amount: 15_000n })
      .send();

    const store = createMemoryStore();
    expect(indexRawTransaction(tx.hex, store)).toBeNull();
  });
});

// --- Tests: JSON persistence (TASK-004, Option A) ------------------------

describe('Indexer — JSON persistence (createJsonFileStore)', () => {
  it('persists the Rating Rights to disk after indexing and reloads them in a new instance', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'repid-store-'));
 const filePath = join(dir, 'store.json');
    try {
      const { partyA, partyB, tx } = await genesisReceipt();

      const store1 = createJsonFileStore(filePath);
      const fact = indexRawTransaction(tx.hex, store1);
      expect(fact.type).toBe('RECEIPT_GENESIS');

      // A second "process" (new store instance, same file) must recover the
      // Rating Rights indexed by the first one.
      const store2 = createJsonFileStore(filePath);
      const rr = fact.ratingRights[0];
      expect(store2.getRatingRight(rr.outpoint)).toMatchObject({
        ownerPkh: rr.ownerPkh,
        ratesPkh: rr.ratesPkh,
      });

      // The file exists and has the expected format.
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

  it('overwrites the file when it already contained a previous state', () => {
    const dir = mkdtempSync(join(tmpdir(), 'repid-store-'));
    const filePath = join(dir, 'store.json');
    try {
      writeFileSync(filePath, JSON.stringify({ ratingRights: { old: { ownerPkh: 'x', ratesPkh: 'y' } } }), 'utf8');

      const store = createJsonFileStore(filePath);
      store.trackRatingRight('new:0', { ownerPkh: 'a', ratesPkh: 'b' });

      const onDisk = JSON.parse(readFileSync(filePath, 'utf8'));
      expect(onDisk.ratingRights['old']).toBeTruthy();
      expect(onDisk.ratingRights['new:0']).toBeTruthy();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// Test utility: the txid used as a mock UTXO is already in "display
// order" (as the SDK returns it), so we only normalize it to bytes to
// compare against what the indexer returns.
function hexToBinDisplay(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}
