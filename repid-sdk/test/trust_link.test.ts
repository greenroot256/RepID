import { describe, it, expect, beforeEach } from 'vitest';
import { MockNetworkProvider, TransactionBuilder, SignatureTemplate } from 'cashscript';
import { binToHex, utf8ToBin } from '@bitauth/libauth';
import { indexRawTransaction, createMemoryStore } from '../src/index.js';
import { hexToBytes } from '../src/bytes.js';
import { OP_RETURN_TAGS } from '../src/constants.js';
import {
  makeParty,
  makeProvider,
  mockUtxo,
  trustOpReturnOutput,
  foreignTagOpReturnOutput,
  expectFact,
  type Party,
} from './helpers.js';

// --- TRUST_LINK (SPEC-006) ------------------------------------------------

const provider: MockNetworkProvider = makeProvider();
let seedCounter = 200;

beforeEach(() => {
  provider.reset();
  seedCounter = 200;
});

describe('TRUST_LINK', () => {
  it('recognizes a unilateral A→B declaration (only A signs, no Rating Rights)', async () => {
    const a = makeParty(seedCounter + 1);
    const b = makeParty(seedCounter + 2);
    seedCounter += 2;
    const utxo = mockUtxo('ee'.repeat(32), 50_000n);
    provider.addUtxo(a.address, utxo);

    const tx = await new TransactionBuilder({ provider })
      .addInput(utxo, new SignatureTemplate(a.privateKey).unlockP2PKH())
      .addOutput(trustOpReturnOutput(binToHex(b.pkh)))
      .addOutput({ to: a.address, amount: 40_000n })
      .send();

    const store = createMemoryStore();
    const fact = expectFact(indexRawTransaction(tx.hex, store), 'TRUST_LINK');

    expect(fact.trusterPkh).toBe(binToHex(a.pkh));
    expect(fact.trustedPkh).toBe(binToHex(b.pkh));
    expect(fact.valid).toBe(true);

    // RF-04: the declaration mints no tokens nor Rating Rights.
    expect(tx.outputs.every((o) => !o.token)).toBe(true);
  });

  it('marks a self-trust declaration as invalid (A trusts A)', async () => {
    const a = makeParty(seedCounter + 1);
    seedCounter += 1;
    const utxo = mockUtxo('ee'.repeat(32), 50_000n);
    provider.addUtxo(a.address, utxo);

    const tx = await new TransactionBuilder({ provider })
      .addInput(utxo, new SignatureTemplate(a.privateKey).unlockP2PKH())
      .addOutput(trustOpReturnOutput(binToHex(a.pkh)))
      .addOutput({ to: a.address, amount: 40_000n })
      .send();

    const fact = expectFact(indexRawTransaction(tx.hex, createMemoryStore()), 'TRUST_LINK');
    expect(fact.trusterPkh).toBe(fact.trustedPkh);
    expect(fact.valid).toBe(false);
  });

  it('does not recognize an OP_RETURN with a foreign tag or a different payload size', async () => {
    const a = makeParty(seedCounter + 1);
    seedCounter += 1;
    const utxo = mockUtxo('ee'.repeat(32), 50_000n);
    provider.addUtxo(a.address, utxo);
    const store = createMemoryStore();

    // Foreign tag.
    const txAlien = await new TransactionBuilder({ provider })
      .addInput(utxo, new SignatureTemplate(a.privateKey).unlockP2PKH())
      .addOutput(foreignTagOpReturnOutput('NOTREPID6'))
      .addOutput({ to: a.address, amount: 40_000n })
      .send();
    expect(indexRawTransaction(txAlien.hex, store)).toBeNull();

    // Correct tag but a 32-byte payload (not a pkh) => not recognized.
    const other: Party = makeParty(seedCounter + 1);
    seedCounter += 1;
    const otherUtxo = mockUtxo('dd'.repeat(32), 50_000n);
    provider.addUtxo(other.address, otherUtxo);

    const tagBytes = utf8ToBin(OP_RETURN_TAGS.TRUST);
    const wrongLen = new Uint8Array([
      0x6a,
      tagBytes.length,
      ...tagBytes,
      0x20,
      ...hexToBytes('ab'.repeat(32)),
    ]);
    const txWrong = await new TransactionBuilder({ provider })
      .addInput(otherUtxo, new SignatureTemplate(other.privateKey).unlockP2PKH())
      .addOutput({ to: wrongLen, amount: 0n })
      .addOutput({ to: other.address, amount: 40_000n })
      .send();
    expect(indexRawTransaction(txWrong.hex, store)).toBeNull();
  });
});
