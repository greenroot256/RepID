import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Contract, MockNetworkProvider, TransactionBuilder, SignatureTemplate, type Utxo } from 'cashscript';
import { binToHex } from '@bitauth/libauth';
import { indexRawTransaction, createMemoryStore } from '../src/index.js';
import { createJsonFileStore } from '../src/node/index.js';
import artifact from './fixtures/identity_vault.json' with { type: 'json' };
import {
  makeParty,
  makeProvider,
  mockUtxo,
  expectFact,
      unlocker,
  type Party,
} from './helpers.js';

// --- IdentityVault (SPEC-001) ---------------------------------------------

const provider: MockNetworkProvider = makeProvider();
let store = createMemoryStore();
let seedCounter = 0;

beforeEach(() => {
  provider.reset();
  store = createMemoryStore();
  seedCounter = 0;
});

function makeContract(ownerPkh: Uint8Array) {
  return new Contract(artifact, [ownerPkh], { provider });
}

/** Mints the vault identity and indexes it, returning the covenant UTXO. */
async function mintIdentity(
  owner: Party,
  contract: ReturnType<typeof makeContract>,
  collateral = 1000n,
) {
  const category = (owner.pkh[0]! * 2654435761 + seedCounter * 97).toString(16).padStart(64, '0');
  const utxo = mockUtxo(category, 10_000n);
  provider.addUtxo(contract.address, utxo);

  const tx = await new TransactionBuilder({ provider })
    .addInput(
      utxo,
      unlocker(contract, 'mint').mint!(owner.publicKey, new SignatureTemplate(owner.privateKey), collateral),
    )
    .addOutput({
      to: contract.tokenAddress,
      amount: collateral,
      token: {
        category: utxo.txid,
        amount: 0n,
        nft: { capability: 'none', commitment: binToHex(owner.pkh) },
      },
    })
    .addBchChangeOutputIfNeeded({ to: owner.address, feeRate: 1 })
    .send();

  const fact = expectFact(indexRawTransaction(tx.hex, store), 'IDENTITY_GENESIS');
  const covenant = await covenantUtxo(contract, category);
  return { utxo, tx, fact, covenant };
}

async function covenantUtxo(
  contract: ReturnType<typeof makeContract>,
  category: string,
): Promise<Utxo> {
  const utxos = await provider.getUtxos(contract.address);
  const found = utxos.find((u) => {
    if (!u.token) return false;
    const cat = typeof u.token.category === 'string' ? u.token.category : binToHex(u.token.category);
    return cat === category;
  });
  if (!found) throw new Error(`covenant UTXO for category ${category} not found`);
  return found;
}

async function topUp(
  owner: Party,
  contract: ReturnType<typeof makeContract>,
  covenant: Utxo,
  category: string,
  newCollateral: bigint,
) {
  const feeUtxo = mockUtxo('bb'.repeat(32), 5_000n);
  provider.addUtxo(owner.address, feeUtxo);
  const tx = await new TransactionBuilder({ provider })
    .addInput(
      covenant,
      unlocker(contract, 'increaseCollateral').increaseCollateral!(owner.publicKey, new SignatureTemplate(owner.privateKey)),
    )
    .addInput(feeUtxo, new SignatureTemplate(owner.privateKey).unlockP2PKH())
    .addOutput({
      to: contract.tokenAddress,
      amount: newCollateral,
      token: { category, amount: 0n, nft: { capability: 'none', commitment: binToHex(owner.pkh) } },
    })
    .addBchChangeOutputIfNeeded({ to: owner.address, feeRate: 1 })
    .send();
  return {
    tx,
    fact: indexRawTransaction(tx.hex, store),
    covenant: await covenantUtxo(contract, category),
  };
}

async function burn(
  owner: Party,
  contract: ReturnType<typeof makeContract>,
  covenant: Utxo,
  category: string,
) {
  const feeUtxo = mockUtxo('bb'.repeat(32), 5_000n);
  provider.addUtxo(owner.address, feeUtxo);
  const tx = await new TransactionBuilder({ provider })
    .addInput(covenant, unlocker(contract, 'burn').burn!(owner.publicKey, new SignatureTemplate(owner.privateKey)))
    .addInput(feeUtxo, new SignatureTemplate(owner.privateKey).unlockP2PKH())
    .addOutput({ to: owner.address, amount: 1000n })
    .addBchChangeOutputIfNeeded({ to: owner.address, feeRate: 1 })
    .send();
  return { tx, fact: indexRawTransaction(tx.hex, store) };
}

describe('Indexer: IdentityVault', () => {
  it('recognizes the vault genesis and tracks the covenant outpoint with collateral and ownerPkh', async () => {
    const owner = makeParty(seedCounter + 1);
    seedCounter += 1;
    const contract = makeContract(owner.pkh);
    const { tx, fact, utxo } = await mintIdentity(owner, contract, 1000n);

    expect(fact.txid).toBe(tx.txid);
    expect(fact.ownerPkh).toBe(binToHex(owner.pkh));
    expect(fact.identityCategory).toBe(utxo.txid);
    expect(fact.collateral).toBe('1000');
    expect(fact.identityOutpoint).toBe(`${tx.txid}:0`);

    expect(store.getIdentity(fact.identityOutpoint!)).toEqual({
      ownerPkh: binToHex(owner.pkh),
      identityCategory: utxo.txid,
      collateral: '1000',
    });
  });

  it('marks a top-up as valid, records IDENTITY_COLLATERAL_TOP_UP and moves the tracking to the new outpoint', async () => {
    const owner = makeParty(seedCounter + 1);
    seedCounter += 1;
    const contract = makeContract(owner.pkh);
    const { utxo, covenant } = await mintIdentity(owner, contract, 1000n);

    const { fact, covenant: newCovenant } = await topUp(owner, contract, covenant, utxo.txid, 1500n);
    const topUpFact = expectFact(fact, 'IDENTITY_COLLATERAL_TOP_UP');

    expect(topUpFact.ownerPkh).toBe(binToHex(owner.pkh));
    expect(topUpFact.previousCollateral).toBe('1000');
    expect(topUpFact.collateral).toBe('1500');
    expect(topUpFact.valid).toBe(true);

    // The old outpoint stopped being tracked and the new one started.
    expect(store.getIdentity(topUpFact.spentOutpoint)).toBeUndefined();
    const tracked = store.getIdentity(`${topUpFact.txid}:0`);
    expect(tracked?.collateral).toBe('1500');
    expect(tracked?.ownerPkh).toBe(binToHex(owner.pkh));
    expect(newCovenant).toBeTruthy();
  });

  it('recognizes the burn as IDENTITY_BURNED and removes the identity tracking', async () => {
    const owner = makeParty(seedCounter + 1);
    seedCounter += 1;
    const contract = makeContract(owner.pkh);
    const { utxo, covenant } = await mintIdentity(owner, contract, 1000n);

    const { fact } = await burn(owner, contract, covenant, utxo.txid);
    const burnedFact = expectFact(fact, 'IDENTITY_BURNED');

    expect(burnedFact.ownerPkh).toBe(binToHex(owner.pkh));
    expect(burnedFact.identityCategory).toBe(utxo.txid);
    expect(burnedFact.valid).toBe(true);
    expect(burnedFact.spentOutpoint).toBeTruthy();
    expect(store.getIdentity(burnedFact.spentOutpoint)).toBeUndefined();
  });

  it('after a burn no longer confuses the owner’s next spend with any RepID shape', async () => {
    const owner = makeParty(seedCounter + 1);
    seedCounter += 1;
    const contract = makeContract(owner.pkh);
    const { utxo, covenant } = await mintIdentity(owner, contract, 1000n);

    // Spending the covenant UTXO as P2PKH is impossible: it is locked to the
    // covenant. What matters here is that once the burn is recognized, the
    // owner's ordinary next transaction is not mistaken for an identity event.
    await burn(owner, contract, covenant, utxo.txid);

    const spending = mockUtxo('cc'.repeat(32), 2_000n);
    provider.addUtxo(owner.address, spending);
    const plainTx = await new TransactionBuilder({ provider })
      .addInput(spending, new SignatureTemplate(owner.privateKey).unlockP2PKH())
      .addOutput({ to: owner.address, amount: 1000n })
      .addBchChangeOutputIfNeeded({ to: owner.address, feeRate: 1 })
      .send();

    expect(indexRawTransaction(plainTx.hex, store)).toBeNull();
  });

  it('persists the identity tracking in the JSON store and survives a reload', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'repid-vault-'));
    const file = join(dir, 'indexer.json');
    const fileStore = createJsonFileStore(file);
    try {
      const owner = makeParty(seedCounter + 1);
      seedCounter += 1;
      const contract = makeContract(owner.pkh);
      const utxo = mockUtxo('aa'.repeat(32), 10_000n);
      provider.addUtxo(contract.address, utxo);

      const tx = await new TransactionBuilder({ provider })
        .addInput(
          utxo,
          unlocker(contract, 'mint').mint!(owner.publicKey, new SignatureTemplate(owner.privateKey), 1000n),
        )
        .addOutput({
          to: contract.tokenAddress,
          amount: 1000n,
          token: {
            category: utxo.txid,
            amount: 0n,
            nft: { capability: 'none', commitment: binToHex(owner.pkh) },
          },
        })
        .addBchChangeOutputIfNeeded({ to: owner.address, feeRate: 1 })
        .send();
      expectFact(indexRawTransaction(tx.hex, fileStore), 'IDENTITY_GENESIS');

      const reloaded = createJsonFileStore(file);
      const ns = reloaded.snapshot();
      expect(ns.identities).toHaveLength(1);
      expect(ns.identities[0]![0]).toBe(`${tx.txid}:0`);
      expect(ns.identities[0]![1].collateral).toBe('1000');
      expect(JSON.parse(readFileSync(file, 'utf8')).identities).toBeTruthy();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
