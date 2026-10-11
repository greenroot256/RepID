// Binding verification, end to end through the recognizer.
//
// covenant_binding.test.ts proves the check rejects impostors and
// real_chain_binding.test.ts proves it accepts transactions a real node
// published. Both call the check directly. Neither proves the recognizer
// *uses* it, which is what a consumer of this SDK depends on: they do not
// call verifyVaultOutputBinding, they call indexRawTransaction and act on
// the answer.
//
// So this file exercises the seam, and the comparison it makes is between two
// recognizers looking at the same bytes: the default one, which sees shapes
// and reports impostors as facts, and the binding one, which rejects them.
//
// Every rejection here is followed by a snapshot comparison, not just a null
// assertion. A rejected transaction that left a trace would be the quiet failure
// mode: the store would hold a Rating Right or an identity that no covenant
// created, and keep producing plausible facts afterwards.

import { describe, it, expect, beforeEach } from 'vitest';
import { Contract, MockNetworkProvider, TransactionBuilder, SignatureTemplate, type Utxo } from 'cashscript';
import { binToHex, decodeTransactionBCH, encodeTransactionBCH, hash160, hash256 } from '@bitauth/libauth';
import { indexRawTransaction, createMemoryStore, hexToBytes, type DecodedTransaction } from '../src/index.js';
import { findFinalPush } from '../src/covenant.js';
import vaultArtifact from './fixtures/identity_vault.json' with { type: 'json' };
import identityArtifact from './fixtures/identity_genesis.json' with { type: 'json' };
import receiptArtifact from './fixtures/receipt_genesis.json' with { type: 'json' };
import ratingRightArtifact from './fixtures/rating_right.json' with { type: 'json' };
import bytecode from '../src/protocol/covenant-bytecode.json' with { type: 'json' };
import {
  makeParty,
  makeProvider,
  mockUtxo,
  ratingOpReturnOutput,
  trustOpReturnOutput,
  ratingRightHashes,
  receiptRights,
  unlocker,
  type Party,
} from './helpers.js';

const VAULT = bytecode.contracts.identityVault;
const RECEIPT = bytecode.contracts.receiptGenesis;

/** The recognizer under test: shape recognition plus covenant linkage. */
const BOUND = { binding: true } as const;

let provider: MockNetworkProvider;
let store = createMemoryStore();
let seed = 0;

beforeEach(() => {
  provider = makeProvider();
  store = createMemoryStore();
  seed = 0;
});

/** An empty store, for the side-by-side comparison. */
function fresh() {
  return createMemoryStore();
}

const txidOf = (hex: string) =>
  binToHex(new Uint8Array(hash256(new Uint8Array(Buffer.from(hex, 'hex')))).reverse());

const EMPTY = { ratingRights: [], receipts: [], identities: [], ratings: [], retractions: [] };

// --- transaction builders --------------------------------------------------

async function mintVault(owner: Party, collateral = 1000n) {
  const contract = new Contract(vaultArtifact, [owner.pkh], { provider });
  const utxo = mockUtxo(category(), 10_000n);
  provider.addUtxo(contract.address, utxo);

  const tx = await new TransactionBuilder({ provider })
    .addInput(
      utxo,
      unlocker(contract, 'mint').mint!(
        owner.publicKey,
        new SignatureTemplate(owner.privateKey),
        collateral,
      ),
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

  return { tx, contract, category: utxo.txid, ownerPkh: binToHex(owner.pkh) };
}

async function mintLegacy(owner: Party) {
  const contract = new Contract(identityArtifact, [owner.pkh], { provider });
  const utxo = mockUtxo(category(), 10_000n);
  provider.addUtxo(contract.address, utxo);

  const tx = await new TransactionBuilder({ provider })
    .addInput(utxo, unlocker(contract, 'mint').mint!())
    .addOutput({
      to: owner.address,
      amount: 1000n,
      token: { category: utxo.txid, amount: 0n, nft: { capability: 'none', commitment: '' } },
    })
    .addBchChangeOutputIfNeeded({ to: owner.address, feeRate: 1 })
    .send();

  return { tx, ownerPkh: binToHex(owner.pkh) };
}

async function mintReceipt(partyA: Party, partyB: Party) {
  // SPEC-008 RF-O825: the genesis locks each Rating Right to the P2SH20 hash of
  // RatingRightVault for that party, passed in as constructor arguments because
  // CashScript 0.13 cannot reference the covenant by name.
  const { hashA, hashB } = ratingRightHashes(partyA, partyB);

  const contract = new Contract(
    receiptArtifact,
    [partyA.pkh, partyB.pkh, hexToBytes(hashA), hexToBytes(hashB)],
    { provider },
  );
  const { vaultForA, vaultForB } = receiptRights(provider, partyA, partyB);
  const utxo = mockUtxo(category(), 10_000n);
  provider.addUtxo(contract.address, utxo);
  const nft = (commitment: string) => ({
    category: utxo.txid,
    amount: 0n,
    nft: { capability: 'none' as const, commitment },
  });

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
    .addOutput({ to: partyA.address, amount: 1000n, token: nft('') })
    // The two Rating Rights now go to the covenant, not to a P2PKH.
    .addOutput({ to: vaultForA.tokenAddress, amount: 1000n, token: nft(binToHex(partyB.pkh)) })
    .addOutput({ to: vaultForB.tokenAddress, amount: 1000n, token: nft(binToHex(partyA.pkh)) })
    .addBchChangeOutputIfNeeded({ to: partyA.address, feeRate: 1 })
    .send();

  return { tx, contract, category: utxo.txid };
}

async function covenantUtxo(contract: Contract, cat: string): Promise<Utxo> {
  const utxos = await provider.getUtxos(contract.address);
  const found = utxos.find((u) => {
    if (!u.token) return false;
    return (typeof u.token.category === 'string' ? u.token.category : binToHex(u.token.category)) === cat;
  });
  if (!found) throw new Error('no covenant utxo');
  return found;
}

async function tokenUtxo(holder: Party, cat: string, address?: string): Promise<Utxo> {
  // Since 0.3.0 a Rating Right lives under RatingRightVault, so the default
  // address to look in is the vault's, not the holder's P2PKH. Pass `address` to
  // override for a right in an older shape.
  const where = address ?? (await receiptRights(provider, holder, holder)).vaultForA.tokenAddress;
  const all = await provider.getUtxos(where);
  const found = all.find((u) => {
    if (!u.token) return false;
    return (typeof u.token.category === 'string' ? u.token.category : binToHex(u.token.category)) === cat;
  });
  if (!found) throw new Error('no token utxo');
  return found;
}

async function topUp(owner: Party, contract: Contract, cat: string, newCollateral: bigint) {
  const covenant = await covenantUtxo(contract, cat);
  const feeUtxo = mockUtxo('bb'.repeat(32), 5_000n);
  provider.addUtxo(owner.address, feeUtxo);

  const tx = await new TransactionBuilder({ provider })
    .addInput(
      covenant,
      unlocker(contract, 'increaseCollateral').increaseCollateral!(
        owner.publicKey,
        new SignatureTemplate(owner.privateKey),
      ),
    )
    .addInput(feeUtxo, new SignatureTemplate(owner.privateKey).unlockP2PKH())
    .addOutput({
      to: contract.tokenAddress,
      amount: newCollateral,
      token: { category: cat, amount: 0n, nft: { capability: 'none', commitment: binToHex(owner.pkh) } },
    })
    .addBchChangeOutputIfNeeded({ to: owner.address, feeRate: 1 })
    .send();

  return tx.hex;
}

async function rate(rater: Party, cat: string, score: number) {
  // The right is spent through RatingRightVault, which is the point of the
  // covenant: the signature goes to the contract, not to a P2PKH, so the chain
  // itself refuses to let the NFT come back (SPEC-008 RF-O12/RF-S01).
  const vault = new Contract(ratingRightArtifact, [rater.pkh], { provider });
  const right = await tokenUtxo(rater, cat, vault.tokenAddress);
  return (
    await new TransactionBuilder({ provider })
      .addInput(
        right,
        unlocker(vault, 'rate').rate!(rater.publicKey, new SignatureTemplate(rater.privateKey)),
      )
      // No token output at all: the Rating Right is an NFT, and leaving it
      // unmentioned is what burns it. That is the whole single-use mechanism.
      .addOutput(ratingOpReturnOutput(score))
      .addBchChangeOutputIfNeeded({ to: rater.address, feeRate: 1 })
      .send()
  ).hex;
}

async function declareTrust(truster: Party, trusted: Party) {
  const utxo = mockUtxo(category(), 10_000n);
  provider.addUtxo(truster.address, utxo);
  return (
    await new TransactionBuilder({ provider })
      .addInput(utxo, new SignatureTemplate(truster.privateKey).unlockP2PKH())
      .addOutput(trustOpReturnOutput(binToHex(trusted.pkh)))
      .addBchChangeOutputIfNeeded({ to: truster.address, feeRate: 1 })
      .send()
  ).hex;
}

function category() {
  return (0x1000 + seed++).toString(16).padStart(64, '0');
}

// --- byte-level impostors --------------------------------------------------
//
// None of these can be built through the builder. The covenant demands joint
// signatures over its own constructor arguments, so a script carrying different
// arguments is a different contract and the builder refuses it. Producing one
// therefore means taking a genuine transaction and rewriting a byte or a push,
// which is exactly what an issuer with no covenant at all would have to do.

function pushData(data: Uint8Array): number[] {
  return data.length < 0x4c ? [data.length, ...data] : [0x4c, data.length, ...data];
}

function replaceRedeemScript(scriptSig: Uint8Array, impostor: Uint8Array): Uint8Array {
  const found = findFinalPush(scriptSig);
  if (!found) throw new Error('scriptSig had no final push');
  return new Uint8Array([...scriptSig.slice(0, found.opcodeAt), ...pushData(impostor)]);
}

/** Re-encodes a transaction after a caller-supplied mutation. */
function mutate(hex: string, change: (tx: DecodedTransaction) => void): string {
  const decoded = decodeTransactionBCH(new Uint8Array(Buffer.from(hex, 'hex')));
  if (typeof decoded === 'string' || decoded === null) {
    throw new Error(`could not decode: ${String(decoded)}`);
  }
  change(decoded as unknown as DecodedTransaction);
  // The two views differ in nothing that re-encoding depends on, but the decoder
  // returns libauth's own type and the encoder wants libauth's own type, and
  // asserting on the structural overlap is not what this file is for.
  return Buffer.from(encodeTransactionBCH(decoded as never)).toString('hex');
}

/** The input that carries a covenant, told apart by how much it pushes. */
function covenantInputIndex(tx: DecodedTransaction, minScript: number): number {
  const at = tx.inputs.findIndex((input) => input.unlockingBytecode.length > minScript + 60);
  if (at === -1) throw new Error('no covenant input found');
  return at;
}

/** The vault genesis with its covenant output swapped for a plain P2PKH. */
function vaultAsP2PKH(hex: string, owner: Party): string {
  return mutate(hex, (tx) => {
    tx.outputs[0]!.lockingBytecode = new Uint8Array([0x76, 0xa9, 0x14, ...owner.pkh, 0x88, 0xac]);
  });
}

/**
 * The genesis with its covenant output re-pointed at a script of the right length
 * that is not the vault's.
 *
 * A genesis is bound by its *output*: the P2SH hash of the canonical script is
 * the only thing that fixes which covenant was deployed, and nothing about the
 * unlocking script can change that. Perturbing the scriptSig here would produce a
 * transaction the VM rejects outright — it could never be confirmed — so the
 * recognizer would be testing something the chain already prevents. The vector
 * worth testing is a hash of a foreign script, which keeps the whole shape.
 */
function vaultToForeignP2SH(hex: string): string {
  return mutate(hex, (tx) => {
    const foreign = new Uint8Array(hexToBytes(VAULT.bytecodeHex));
    foreign[foreign.length - 1] = foreign[foreign.length - 1]! ^ 0xff;
    tx.outputs[0]!.lockingBytecode = p2shOf(foreign);
  });
}

/** The P2SH locking script for a script: OP_HASH160 <hash160> OP_EQUAL, then push. */
function p2shOf(script: Uint8Array): Uint8Array {
  const digest = hash160(script);
  return new Uint8Array([0xa9, 0x14, ...new Uint8Array(digest), 0x87]);
}

/**
 * A spend of a tracked vault outpoint, revealing a script of the right length
 * that is not the vault's.
 *
 * Unlike a genesis, a spend is bound by what it *reveals*: there is no new output
 * naming a script, so the unlocking script is the whole of the evidence. This is
 * therefore the vector that matters for a top-up and a burn.
 */
function spendRevealingForeignScript(hex: string): string {
  return mutate(hex, (tx) => {
    const at = covenantInputIndex(tx, VAULT.bytecodeBytes);
    const found = findFinalPush(tx.inputs[at]!.unlockingBytecode);
    if (!found) throw new Error('the spend revealed no redeem script');
    const forged = new Uint8Array(found.data);
    forged[forged.length - 1] = forged[forged.length - 1]! ^ 0xff;
    tx.inputs[at]!.unlockingBytecode = replaceRedeemScript(
      tx.inputs[at]!.unlockingBytecode,
      forged,
    );
  });
}

/** The genesis, revealing the body alone: no constructor arguments. */
function vaultWithoutArguments(hex: string): string {
  return mutate(hex, (tx) => {
    const at = covenantInputIndex(tx, VAULT.bytecodeBytes);
    tx.inputs[at]!.unlockingBytecode = replaceRedeemScript(
      tx.inputs[at]!.unlockingBytecode,
      hexToBytes(VAULT.bytecodeHex),
    );
  });
}

/** The receipt genesis, revealing the body alone. */
function receiptWithoutArguments(hex: string): string {
  return mutate(hex, (tx) => {
    const at = covenantInputIndex(tx, RECEIPT.bytecodeBytes);
    tx.inputs[at]!.unlockingBytecode = replaceRedeemScript(
      tx.inputs[at]!.unlockingBytecode,
      hexToBytes(RECEIPT.bytecodeHex),
    );
  });
}

// --- the seam --------------------------------------------------------------

describe('the default recognizer makes no claim it cannot back', () => {
  it('reports an impostor vault genesis as an identity', async () => {
    // Not a defect. Shape recognition was never claiming more (SPEC-009
    // section 11), and this test exists so that the pair of tests below reads
    // as a change in behaviour rather than a change in belief.
    const owner = makeParty(++seed);
    const { tx } = await mintVault(owner);
    const forged = vaultAsP2PKH(tx.hex, owner);

    expect(indexRawTransaction(forged, fresh())?.type).toBe('IDENTITY_GENESIS');
  });

  it('reports a vault genesis re-pointed at a foreign script as an identity', async () => {
    const owner = makeParty(++seed);
    const { tx } = await mintVault(owner);

    expect(indexRawTransaction(vaultToForeignP2SH(tx.hex), fresh())?.type).toBe('IDENTITY_GENESIS');
  });
});

describe('with binding on', () => {
  it('accepts a genuine vault genesis and establishes an identity', async () => {
    const owner = makeParty(++seed);
    const { tx, ownerPkh } = await mintVault(owner);

    const fact = indexRawTransaction(tx.hex, store, BOUND);
    expect(fact).toMatchObject({ type: 'IDENTITY_GENESIS', ownerPkh, collateral: '1000' });
    expect(store.getIdentityByOwner(ownerPkh)).toMatchObject({ collateral: '1000' });
  });

  it('withholds standing from a vault genesis whose output is a plain P2PKH', async () => {
    const owner = makeParty(++seed);
    const { tx, ownerPkh } = await mintVault(owner);
    const forged = vaultAsP2PKH(tx.hex, owner);

    // Swapping the covenant output for a P2PKH is not rejected, because there is
    // nothing to reject on: an NFT sitting on a P2PKH beside a change output is
    // exactly the shape RF-W35 defines as a legacy genesis. Binding cannot tell
    // the two apart, and must not pretend to.
    const fact = indexRawTransaction(forged, store, BOUND);
    expect(fact).toMatchObject({ type: 'IDENTITY_GENESIS', ownerPkh });
    expect(fact && 'identityOutpoint' in fact).toBe(false);
    expect(fact && 'collateral' in fact).toBe(false);

    // What matters is that the demotion is silent. No tracked outpoint, so a
    // later spend is checked against nothing and no identity comes into being.
    expect(store.snapshot()).toEqual(EMPTY);
    expect(store.getIdentityByOwner(ownerPkh)).toBeUndefined();
  });

  it('rejects a vault genesis revealing a foreign script, leaving no trace', async () => {
    const owner = makeParty(++seed);
    const { tx, ownerPkh } = await mintVault(owner);

    expect(indexRawTransaction(vaultToForeignP2SH(tx.hex), store, BOUND)).toBeNull();

    // The quiet failure this guards against: a tracked outpoint for an identity
    // no covenant created, which a later top-up would happily build on.
    expect(store.snapshot()).toEqual(EMPTY);
    expect(store.getIdentityByOwner(ownerPkh)).toBeUndefined();
  });

  it('accepts a genuine receipt genesis and tracks its Rating Rights', async () => {
    const partyA = makeParty(++seed);
    const partyB = makeParty(++seed);
    const { tx } = await mintReceipt(partyA, partyB);

    const fact = indexRawTransaction(tx.hex, store, BOUND);
    expect(fact?.type).toBe('RECEIPT_GENESIS');
    // Rating Rights are outpoints of the Receipt itself, so they are keyed by the
    // genesis txid and not by the category that funded the covenant.
    expect(store.snapshot().ratingRights.map(([outpoint]) => outpoint)).toEqual([
      `${fact?.txid}:1`,
      `${fact?.txid}:2`,
    ]);
    expect(store.getReceipt(fact?.txid!)?.receiptOwnerPkh).toBe(binToHex(partyA.pkh));
  });

  it('rejects a receipt genesis that reveals the body without its arguments', async () => {
    // The covenant body is canonical and would pass any check comparing only the
    // program. Without the constructor arguments it is a different, much weaker
    // contract, and the outputs that made the shape recognizable are untouched.
    const partyA = makeParty(++seed);
    const partyB = makeParty(++seed);
    const { tx } = await mintReceipt(partyA, partyB);
    const forged = receiptWithoutArguments(tx.hex);

    expect(indexRawTransaction(forged, fresh())?.type).toBe('RECEIPT_GENESIS');
    expect(indexRawTransaction(forged, store, BOUND)).toBeNull();
    // A rejected Receipt must not leave Rating Rights behind. Two of them would
    // let ratings resolve against rights no covenant ever issued.
    expect(store.snapshot()).toEqual(EMPTY);
  });

  it('still recognizes a legacy genesis, and gives it no identity', async () => {
    // SPEC-008 RF-V13 and SPEC-009 RF-W53 end to end. No covenant, so nothing to
    // verify and nothing to reject: the fact stands. It is never tracked, so it
    // is not an identity either.
    const owner = makeParty(++seed);
    const { tx, ownerPkh } = await mintLegacy(owner);

    const fact = indexRawTransaction(tx.hex, store, BOUND);
    expect(fact?.type).toBe('IDENTITY_GENESIS');
    expect(fact).not.toHaveProperty('identityOutpoint');
    expect(store.getIdentityByOwner(ownerPkh)).toBeUndefined();
  });

  it('accepts a genuine top-up and advances the collateral', async () => {
    const owner = makeParty(++seed);
    const { tx, contract, category: cat, ownerPkh } = await mintVault(owner);
    indexRawTransaction(tx.hex, store, BOUND);

    expect(indexRawTransaction(await topUp(owner, contract, cat, 2000n), store, BOUND)).toMatchObject({
      type: 'IDENTITY_COLLATERAL_TOP_UP',
      collateral: '2000',
      previousCollateral: '1000',
      valid: true,
    });
    expect(store.getIdentityByOwner(ownerPkh)?.collateral).toBe('2000');
  });

  it('rejects a top-up revealing a foreign script without moving the tracking', async () => {
    const owner = makeParty(++seed);
    const { tx, contract, category: cat, ownerPkh } = await mintVault(owner);
    indexRawTransaction(tx.hex, store, BOUND);
    const before = store.snapshot();

    const genuine = await topUp(owner, contract, cat, 2000n);
    expect(indexRawTransaction(spendRevealingForeignScript(genuine), store, BOUND)).toBeNull();

    // The impostor's outpoint must not become the tracked one, or the next spend
    // would be validated against a script that was never deployed.
    expect(store.snapshot()).toEqual(before);
    expect(store.getIdentityByOwner(ownerPkh)?.collateral).toBe('1000');
  });

  it('recognizes ratings, which have no covenant, without rejecting them', async () => {
    const partyA = makeParty(++seed);
    const partyB = makeParty(++seed);
    const { tx, category: cat } = await mintReceipt(partyA, partyB);
    indexRawTransaction(tx.hex, store, BOUND);

    const fact = indexRawTransaction(await rate(partyB, cat, 4), store, BOUND);
    expect(fact).toMatchObject({ type: 'RATING_ISSUED', valid: true, score: 4 });

    // Single use is per participant, not per Receipt: partyB's right is gone so
    // it cannot rate twice, and partyA's survives because A has not rated yet.
    const remaining = store.snapshot().ratingRights;
    expect(remaining).toHaveLength(1);
    expect(remaining[0]![1].ownerPkh).toBe(binToHex(partyA.pkh));
  });

  it('gives identical results with and without binding for trust links', async () => {
    // Binding is a covenant check, not a general strictness dial.
    const truster = makeParty(++seed);
    const trusted = makeParty(++seed);
    const hex = await declareTrust(truster, trusted);

    expect(indexRawTransaction(hex, store, BOUND)).toEqual(
      indexRawTransaction(hex, fresh()),
    );
  });
});

describe('the txid is not affected by any of this', () => {
  it('anchors the fact either way', async () => {
    const owner = makeParty(++seed);
    const { tx } = await mintVault(owner);

    expect(indexRawTransaction(tx.hex, fresh(), BOUND)?.txid).toBe(txidOf(tx.hex));
    expect(indexRawTransaction(tx.hex, fresh())?.txid).toBe(txidOf(tx.hex));
  });
});