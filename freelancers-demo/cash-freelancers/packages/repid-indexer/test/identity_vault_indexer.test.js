import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Contract,
  MockNetworkProvider,
  TransactionBuilder,
  SignatureTemplate,
} from 'cashscript';
import { generatePrivateKey, secp256k1, hash160, lockingBytecodeToCashAddress, binToHex } from '@bitauth/libauth';
import artifact from './fixtures/identity_vault.json' with { type: 'json' };
import { indexRawTransaction, createMemoryStore, createJsonFileStore } from '@repid/indexer';

// --- Helpers -------------------------------------------------------------

const provider = new MockNetworkProvider();
const store = createMemoryStore();

let seedCounter = 0;
function makeOwner() {
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

function makeContract(ownerPkh) {
  return new Contract(artifact, [ownerPkh], { provider });
}

// Mints the vault identity with the requested collateral and returns the already
// indexed tx + the covenant UTXO (to top up/burn later). Each genesis uses a
// unique category so tests do not collide.
async function mintIdentity(owner, contract, collateral = 1000n) {
  const category = (owner.pkh[0] * 2654435761 + seedCounter * 97).toString(16).padStart(64, '0');
  const utxo = { txid: category, vout: 0, satoshis: 10_000n };
  provider.addUtxo(contract.address, utxo);
  const tx = await new TransactionBuilder({ provider })
    .addInput(utxo, contract.unlock.mint(owner.publicKey, new SignatureTemplate(owner.privateKey), collateral))
    .addOutput({
      to: contract.tokenAddress,
      amount: collateral,
      token: { category: utxo.txid, amount: 0n, nft: { capability: 'none', commitment: binToHex(owner.pkh) } },
    })
    .addBchChangeOutputIfNeeded({ to: owner.address, feeRate: 1 })
    .send();

  const fact = indexRawTransaction(tx.hex, store);
  const covenant = await covenantUtxo(contract, category);
  return { utxo, tx, fact, covenant };
}

async function covenantUtxo(contract, category) {
  const utxos = await provider.getUtxos(contract.address);
  return utxos.find((u) => u.token && (typeof u.token.category === 'string' ? u.token.category : binToHex(u.token.category)) === category);
}

async function topUp(owner, contract, covenant, category, newCollateral) {
  const feeUtxo = { txid: 'bb'.repeat(32), vout: 0, satoshis: 5_000n };
  provider.addUtxo(owner.address, feeUtxo);
  const tx = await new TransactionBuilder({ provider })
    .addInput(covenant, contract.unlock.increaseCollateral(owner.publicKey, new SignatureTemplate(owner.privateKey)))
    .addInput(feeUtxo, new SignatureTemplate(owner.privateKey).unlockP2PKH())
    .addOutput({
      to: contract.tokenAddress,
      amount: newCollateral,
      token: { category, amount: 0n, nft: { capability: 'none', commitment: binToHex(owner.pkh) } },
    })
    .addBchChangeOutputIfNeeded({ to: owner.address, feeRate: 1 })
    .send();
  return { tx, fact: indexRawTransaction(tx.hex, store), covenant: await covenantUtxo(contract, category) };
}

async function burn(owner, contract, covenant, category) {
  const feeUtxo = { txid: 'bb'.repeat(32), vout: 0, satoshis: 5_000n };
  provider.addUtxo(owner.address, feeUtxo);
  const tx = await new TransactionBuilder({ provider })
    .addInput(covenant, contract.unlock.burn(owner.publicKey, new SignatureTemplate(owner.privateKey)))
    .addInput(feeUtxo, new SignatureTemplate(owner.privateKey).unlockP2PKH())
    .addOutput({ to: owner.address, amount: 1000n })
    .addBchChangeOutputIfNeeded({ to: owner.address, feeRate: 1 })
    .send();
  return { tx, fact: indexRawTransaction(tx.hex, store) };
}

beforeEach(() => {
  provider.reset();
});

// --- Tests ---------------------------------------------------------------

describe('Indexer: IdentityVault', () => {
  it('recognizes the vault genesis and tracks the covenant outpoint with collateral and ownerPkh', async () => {
    const owner = makeOwner();
    const contract = makeContract(owner.pkh);
    const { tx, fact, utxo } = await mintIdentity(owner, contract, 1000n);

    expect(fact.type).toBe('IDENTITY_GENESIS');
    expect(fact.txid).toBe(tx.txid);
    expect(fact.ownerPkh).toBe(binToHex(owner.pkh));
    expect(fact.identityCategory).toBe(utxo.txid);
    expect(fact.collateral).toBe('1000');
    expect(fact.identityOutpoint).toBe(`${tx.txid}:0`);

    const tracked = store.getIdentity(fact.identityOutpoint);
    expect(tracked).toEqual({
      ownerPkh: binToHex(owner.pkh),
      identityCategory: utxo.txid,
      collateral: '1000',
    });
  });

  it('marks a top-up as valid, records IDENTITY_COLLATERAL_TOP_UP and moves the tracking to the new outpoint', async () => {
    const owner = makeOwner();
    const contract = makeContract(owner.pkh);
    const { utxo, covenant } = await mintIdentity(owner, contract, 1000n);

    const { fact, covenant: newCovenant } = await topUp(owner, contract, covenant, utxo.txid, 1500n);

    expect(fact.type).toBe('IDENTITY_COLLATERAL_TOP_UP');
    expect(fact.ownerPkh).toBe(binToHex(owner.pkh));
    expect(fact.previousCollateral).toBe('1000');
    expect(fact.collateral).toBe('1500');
    expect(fact.valid).toBe(true);

    // The old outpoint stopped being tracked and the new one started.
    expect(store.getIdentity(fact.spentOutpoint)).toBeUndefined();
    const tracked = store.getIdentity(`${fact.txid}:0`);
    expect(tracked.collateral).toBe('1500');
    expect(tracked.ownerPkh).toBe(binToHex(owner.pkh));
    expect(newCovenant).toBeTruthy();
  });

  it('recognizes the burn as IDENTITY_BURNED and removes the identity tracking', async () => {
    const owner = makeOwner();
    const contract = makeContract(owner.pkh);
    const { utxo, covenant } = await mintIdentity(owner, contract, 1000n);

    const { fact } = await burn(owner, contract, covenant, utxo.txid);

    expect(fact.type).toBe('IDENTITY_BURNED');
    expect(fact.ownerPkh).toBe(binToHex(owner.pkh));
    expect(fact.identityCategory).toBe(utxo.txid);
    expect(fact.valid).toBe(true);
    expect(fact.spentOutpoint).toBeTruthy();
    expect(store.getIdentity(fact.spentOutpoint)).toBeUndefined();
  });

  it('after a burn the indexer no longer confuses the P2PKH spend with any RepID shape', async () => {
    const owner = makeOwner();
    const contract = makeContract(owner.pkh);
    const { utxo, covenant } = await mintIdentity(owner, contract, 1000n);

    // Instead of a covenant burn, manually spending the covenant UTXO as
    // P2PKH is not possible (it is locked to the covenant). The real burn was
    // already covered above; here we only verify that the owner's next spend
    // is NOT recognized as an identity because no outpoint is tracked.
    await burn(owner, contract, covenant, utxo.txid);

    const spending = { txid: 'cc'.repeat(32), vout: 0, satoshis: 2_000n };
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
      const owner = makeOwner();
      const contract = makeContract(owner.pkh);
      const utxo = { txid: 'aa'.repeat(32), vout: 0, satoshis: 10_000n };
      provider.addUtxo(contract.address, utxo);
      const tx = await new TransactionBuilder({ provider })
        .addInput(utxo, contract.unlock.mint(owner.publicKey, new SignatureTemplate(owner.privateKey), 1000n))
        .addOutput({
          to: contract.tokenAddress,
          amount: 1000n,
          token: { category: utxo.txid, amount: 0n, nft: { capability: 'none', commitment: binToHex(owner.pkh) } },
        })
        .addBchChangeOutputIfNeeded({ to: owner.address, feeRate: 1 })
        .send();
      indexRawTransaction(tx.hex, fileStore);

      const reloaded = createJsonFileStore(file);
      const ns = reloaded.snapshot();
      expect(ns.identities.length).toBe(1);
      expect(ns.identities[0][0]).toBe(`${tx.txid}:0`);
      expect(ns.identities[0][1].collateral).toBe('1000');
      expect(JSON.parse(readFileSync(file, 'utf8')).identities).toBeTruthy();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});