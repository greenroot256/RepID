import { describe, it, expect, beforeEach } from 'vitest';
import {
  MockNetworkProvider,
  TransactionBuilder,
  SignatureTemplate,
} from 'cashscript';
import {
  generatePrivateKey, secp256k1, hash160, lockingBytecodeToCashAddress, binToHex, utf8ToBin,
} from '@bitauth/libauth';
import { indexRawTransaction, createMemoryStore } from '@repid/indexer';
import { REPID_TRUST_TAG } from '@repid/protocol';

// --- Helpers -------------------------------------------------------------

const provider = new MockNetworkProvider();

let seedCounter = 200;
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

// OP_RETURN of a TRUST_LINK: OP_RETURN <tag REPID_TRUST1> <B pkh (20 bytes)>.
// Unilateral: only A signs and pays; B does not take part in the transaction.
function trustOpReturnOutput(trustedPkhHex) {
  const tagBytes = utf8ToBin(REPID_TRUST_TAG);
  const pkhBytes = hexToBytes(trustedPkhHex);
  const bytecode = new Uint8Array([
    0x6a, tagBytes.length, ...tagBytes, pkhBytes.length, ...pkhBytes,
  ]);
  return { to: bytecode, amount: 0n };
}

// Gives `owner` a normal-funds UTXO to spend it in the declaration.
function fundUtxo(owner, satoshis = 50_000n) {
  const utxo = { txid: 'ee'.repeat(32), vout: 0, satoshis };
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
  seedCounter = 200;
});

// --- Tests: TRUST_LINK (SPEC-006, TASK-018) ------------------------------

describe('TRUST_LINK', () => {
  it('recognizes a unilateral A→B declaration (only A signs, no Rating Rights)', async () => {
    const a = makeParty();
    const b = makeParty();
    const utxo = fundUtxo(a);

    const tx = await new TransactionBuilder({ provider })
      .addInput(utxo, new SignatureTemplate(a.privateKey).unlockP2PKH())
      .addOutput(trustOpReturnOutput(binToHex(b.pkh)))
      .addOutput({ to: a.address, amount: 40_000n })
      .send();

    const store = createMemoryStore();
    const fact = indexRawTransaction(tx.hex, store);

    expect(fact.type).toBe('TRUST_LINK');
    expect(fact.trusterPkh).toBe(binToHex(a.pkh));
    expect(fact.trustedPkh).toBe(binToHex(b.pkh));
    expect(fact.valid).toBe(true);

    // RF-04: the declaration mints no tokens nor Rating Rights.
    expect(tx.outputs.every((o) => !o.token)).toBe(true);
  });

  it('marks a self-trust declaration as invalid (A trusts A)', async () => {
    const a = makeParty();
    const utxo = fundUtxo(a);

    const tx = await new TransactionBuilder({ provider })
      .addInput(utxo, new SignatureTemplate(a.privateKey).unlockP2PKH())
      .addOutput(trustOpReturnOutput(binToHex(a.pkh)))
      .addOutput({ to: a.address, amount: 40_000n })
      .send();

    const store = createMemoryStore();
    const fact = indexRawTransaction(tx.hex, store);

    expect(fact.type).toBe('TRUST_LINK');
    expect(fact.trusterPkh).toBe(fact.trustedPkh);
    expect(fact.valid).toBe(false);
  });

  it('does not recognize an OP_RETURN with a foreign tag or a different payload size', async () => {
    const a = makeParty();
    const utxo = fundUtxo(a);
    const store = createMemoryStore();

    // Foreign tag.
    const alienBytes = utf8ToBin('NOTREPID6');
    const alienBytecode = new Uint8Array([0x6a, alienBytes.length, ...alienBytes]);
    const txAlien = await new TransactionBuilder({ provider })
      .addInput(utxo, new SignatureTemplate(a.privateKey).unlockP2PKH())
      .addOutput({ to: alienBytecode, amount: 0n })
      .addOutput({ to: a.address, amount: 40_000n })
      .send();
    expect(indexRawTransaction(txAlien.hex, store)).toBeNull();

    // Correct tag but a 32-byte payload (not a pkh) => not recognized.
    const other = makeParty();
    const otherUtxo = fundUtxo(other);
    const tagBytes = utf8ToBin(REPID_TRUST_TAG);
    const wrongLen = new Uint8Array([0x6a, tagBytes.length, ...tagBytes, 0x20, ...hexToBytes('ab'.repeat(32))]);
    const txWrong = await new TransactionBuilder({ provider })
      .addInput(otherUtxo, new SignatureTemplate(other.privateKey).unlockP2PKH())
      .addOutput({ to: wrongLen, amount: 0n })
      .addOutput({ to: other.address, amount: 40_000n })
      .send();
    expect(indexRawTransaction(txWrong.hex, store)).toBeNull();
  });
});