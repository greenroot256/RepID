// Receipt genesis output shape (SPEC-009 section 9.2, RF-W38..RF-W40).
//
// Two positive cases for the canonical shape already existed in the migrated
// suite. What was missing was the negative half, and building it turned up a
// fact worth stating up front, because it changes what these tests are for:
//
//   A malformed Receipt is already impossible to produce through the covenant.
//   `receipt_genesis` has 20 `require` statements -- four outputs, one shared
//   category, zero token amounts, the cross-paired commitments, P2PKH on every
//   output -- and CashTokens itself refuses the rest: an NFT with capability
//   `mutable` or `minting` changes the category the following outputs are
//   checked against, so a genesis using one fails `tokenCategory == category`
//   before the commitment checks are even reached.
//
//   So a negative test that builds its transaction through the real covenant
//   proves nothing: `MockNetworkProvider` runs the CashVM for contract inputs,
//   so the builder refuses the transaction and the recognizer never sees it.
//   (The suite's own note that the provider "does not execute the Bitcoin VM" is
//   true of the node's validation, not of the builder's debug run. An earlier
//   draft of this file assumed otherwise and produced 14 failures that said
//   nothing about the code under test.)
//
//   Which leaves the recognizer's own checks untested by construction. The fix
//   is to build the canonical transaction once and then perturb the decoded
//   outputs, so the bytes differ from a valid Receipt in exactly one field. That
//   is the only way to ask the question this section actually asks: given these
//   bytes, does the recognizer reject them on its own, without depending on
//   something that ran earlier?
//
// The recognizer's capability check is therefore defense in depth rather than a
// live hole. It is kept because the whole point of the recognizer is to be
// checkable on its own, and because a rule that is unreachable today is one
// guardrail further from being removed by accident.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  Contract,
  MockNetworkProvider,
  TransactionBuilder,
  SignatureTemplate,
} from 'cashscript';
import { binToHex, decodeTransactionBCH, encodeTransactionBCH } from '@bitauth/libauth';
import { indexRawTransaction, createMemoryStore, hexToBytes, toHex } from '../src/index.js';
import receiptArtifact from './fixtures/receipt_genesis.json' with { type: 'json' };
import ratingRightArtifact from './fixtures/rating_right.json' with { type: 'json' };
import {
  makeParty,
  makeProvider,
  mockUtxo,
  expectFact,
  ratingRightHashes,
  unlocker,
  type Party,
} from './helpers.js';

const provider: MockNetworkProvider = makeProvider();
let seedCounter = 0;

beforeEach(() => {
  provider.reset();
  seedCounter = 0;
});

type Capability = 'none' | 'mutable' | 'minting';

const CATEGORY = 'aa'.repeat(32);
const OTHER_CATEGORY = 'dd'.repeat(32);
const EMPTY = new Uint8Array(0);

/** The canonical three NFTs of a Receipt genesis. */
function canonicalNfts(partyA: Party, partyB: Party) {
  return {
    receipt: { capability: 'none' as Capability, commitment: '' },
    rightForA: { capability: 'none' as Capability, commitment: binToHex(partyB.pkh) },
    rightForB: { capability: 'none' as Capability, commitment: binToHex(partyA.pkh) },
  };
}

/** Mints a canonical Receipt through the real covenant, both parties signing. */
async function mintCanonical(): Promise<{
  hex: string;
  partyA: Party;
  partyB: Party;
  contract: Contract;
  vaultForA: Contract;
  vaultForB: Contract;
}> {
  const partyA = makeParty(seedCounter + 1);
  const partyB = makeParty(seedCounter + 2);
  seedCounter += 2;

// SPEC-008 RF-O825: both Rating Rights are locked under RatingRightVault,
  // whose P2SH20 hash for each party is a constructor argument.
  const { hashA, hashB } = ratingRightHashes(partyA, partyB);
  const contract = new Contract(
    receiptArtifact,
    [partyA.pkh, partyB.pkh, hexToBytes(hashA), hexToBytes(hashB)],
    { provider },
  );
  // The rights go under the RatingRightVault, which is a *different* contract
  // from the one running mint(): instantiating it separately here is what makes
  // the P2SH20 hash in the output the one the genesis committed to.
  const vaultForA = new Contract(ratingRightArtifact, [partyA.pkh], { provider });
  const vaultForB = new Contract(ratingRightArtifact, [partyB.pkh], { provider });
  const utxo = mockUtxo(CATEGORY, 10_000n);
  provider.addUtxo(contract.address, utxo);

  const nfts = canonicalNfts(partyA, partyB);
  const token = (spec: { capability: Capability; commitment: string }) => ({
    category: CATEGORY,
    amount: 0n,
    nft: spec,
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
    .addOutput({ to: partyA.address, amount: 1000n, token: token(nfts.receipt) })
    .addOutput({ to: vaultForA.tokenAddress, amount: 1000n, token: token(nfts.rightForA) })
    .addOutput({ to: vaultForB.tokenAddress, amount: 1000n, token: token(nfts.rightForB) })
    .addOutput({ to: partyA.address, amount: 6000n })
    .send();

  return { hex: tx.hex, partyA, partyB, contract, vaultForA, vaultForB };
}

/** The subset of libauth's decoded output this file mutates. */
interface MutableOutput {
  lockingBytecode: Uint8Array;
  valueSatoshis: bigint;
  token?: {
    category: Uint8Array;
    amount: bigint;
    nft?: { capability: string; commitment?: Uint8Array };
  } | null;
}
type MutableOutputs = MutableOutput[];

/**
 * Returns the same transaction with its outputs perturbed, re-serialized.
 *
 * `encodeTransactionBCH` returns bytes rather than hex, and does not reproduce
 * the original bytes exactly -- it re-encodes from the decoded view -- so the
 * result is a different transaction with a different txid. That is fine: the
 * recognizer derives the txid from the hex it is handed, and nothing afterwards
 * references the canonical transaction's outpoints. The outputs are what the
 * recognizer reads, and those are what the callback changes.
 *
 * libauth's encoder requires `nft.commitment` to be present even when empty, so
 * an empty commitment is written as a zero-length array rather than left out.
 */
function perturbOutputs(hex: string, mutate: (outputs: MutableOutputs) => void): string {
  const decoded: unknown = decodeTransactionBCH(Buffer.from(hex, 'hex'));
  if (typeof decoded === 'string' || decoded === null || typeof decoded !== 'object') {
    throw new Error('failed to decode the canonical transaction');
  }
  // The parameter type is derived rather than imported, so it cannot drift out of
  // step with libauth. The intersection adds the mutable view of `outputs`; the
  // encoder still sees the type it declares.
  const tx = decoded as unknown as EncodableTransaction & { outputs: MutableOutputs };
  mutate(tx.outputs);
  return toHex(encodeTransactionBCH(tx));
}

type EncodableTransaction = Parameters<typeof encodeTransactionBCH>[0];

const bytes = (hex: string): Uint8Array => new Uint8Array(Buffer.from(hex, 'hex'));
const p2pkh = (party: Party): Uint8Array => bytes('76a914' + party.pkhHex + '88ac');
const recognized = (hex: string) => indexRawTransaction(hex, createMemoryStore());

describe('RECEIPT_GENESIS / the canonical shape (RF-W38..RF-W40)', () => {
  it('recognizes a Receipt minted by the covenant and reports the cross pair', async () => {
    const { hex, partyA, partyB } = await mintCanonical();

    const fact = expectFact(recognized(hex), 'RECEIPT_GENESIS');
    expect(fact.receiptCategory).toBe(CATEGORY);
    // The Receipt is held by partyA, who paid for the genesis.
    expect(fact.receiptOwnerPkh).toBe(partyA.pkhHex);

    // Each right names its own holder and the party it entitles them to rate.
    expect(fact.ratingRights).toHaveLength(2);
    const [first, second] = fact.ratingRights;
    expect(first?.ownerPkh).toBe(partyA.pkhHex);
    expect(first?.ratesPkh).toBe(partyB.pkhHex);
    expect(second?.ownerPkh).toBe(partyB.pkhHex);
    expect(second?.ratesPkh).toBe(partyA.pkhHex);
  });

  it('recognizes the same three NFTs without the change output', async () => {
    // The covenant always produces four outputs, so the three-output form the
    // recognizer also accepts cannot be minted through it. The tolerance is real
    // anyway: SPEC-005's genesis funding leaves the whole balance in the
    // contract, so a funder may pay the fee from a separate input.
    const { hex } = await mintCanonical();
    const threeOutputs = perturbOutputs(hex, (outputs) => outputs.pop());

    expectFact(recognized(threeOutputs), 'RECEIPT_GENESIS');
  });
});

describe('RECEIPT_GENESIS / output count (RF-W38)', () => {
  it('rejects a genesis with only two outputs, missing a Rating Right', async () => {
    const { hex } = await mintCanonical();
    const twoOutputs = perturbOutputs(hex, (outputs) => outputs.splice(2, 2));

    expect(recognized(twoOutputs)).toBeNull();
  });

  it('rejects a genesis with five outputs, one more than a change output', async () => {
    const { hex, partyB } = await mintCanonical();
    const fiveOutputs = perturbOutputs(hex, (outputs) => {
      const change = outputs[3];
      if (change) outputs.push({ ...change, lockingBytecode: p2pkh(partyB) });
    });

    expect(recognized(fiveOutputs)).toBeNull();
  });

  it('rejects a genesis whose change output carries a token', async () => {
    // The change output is the funder's own. A token on it would put a fourth
    // NFT in the category, which is the shape a stray mint would take.
    const { hex, partyA } = await mintCanonical();
    const withToken = perturbOutputs(hex, (outputs) => {
      const change = outputs[3];
      if (change) {
        change.token = { category: bytes(CATEGORY), amount: 0n, nft: { capability: 'none', commitment: EMPTY } };
        change.lockingBytecode = p2pkh(partyA);
      }
    });

    expect(recognized(withToken)).toBeNull();
  });
});

describe('RECEIPT_GENESIS / capability (RF-W39)', () => {
  it('rejects a Receipt NFT with capability mutable', async () => {
    const { hex } = await mintCanonical();
    const mutable = perturbOutputs(hex, (outputs) => {
      if (outputs[0]?.token?.nft) outputs[0].token!.nft!.capability = 'mutable';
    });

    expect(recognized(mutable)).toBeNull();
  });

  it('rejects a Receipt NFT with capability minting', async () => {
    const { hex } = await mintCanonical();
    const minting = perturbOutputs(hex, (outputs) => {
      if (outputs[0]?.token?.nft) outputs[0].token!.nft!.capability = 'minting';
    });

    expect(recognized(minting)).toBeNull();
  });

  it('rejects a mutable Rating Right even when the Receipt itself is fine', async () => {
    const { hex } = await mintCanonical();
    const mutable = perturbOutputs(hex, (outputs) => {
      for (const index of [1, 2]) {
        const nft = outputs[index]?.token?.nft;
        if (nft) nft.capability = 'mutable';
      }
    });

    expect(recognized(mutable)).toBeNull();
  });

  it('rejects a minting Rating Right', async () => {
    const { hex } = await mintCanonical();
    const minting = perturbOutputs(hex, (outputs) => {
      const nft = outputs[1]?.token?.nft;
      if (nft) nft.capability = 'minting';
    });

    expect(recognized(minting)).toBeNull();
  });
});

describe('RECEIPT_GENESIS / token amounts and categories (RF-W39)', () => {
  it('rejects an NFT that carries a fungible amount', async () => {
    const { hex } = await mintCanonical();
    const withAmount = perturbOutputs(hex, (outputs) => {
      if (outputs[0]?.token) outputs[0].token!.amount = 1n;
    });

    expect(recognized(withAmount)).toBeNull();
  });

  it('rejects NFTs that do not share one category', async () => {
    // The category is what ties the three NFTs together, so splitting it splits
    // the Receipt into unrelated tokens.
    const { hex } = await mintCanonical();
    const split = perturbOutputs(hex, (outputs) => {
      if (outputs[1]?.token) outputs[1].token!.category = bytes(OTHER_CATEGORY);
    });

    expect(recognized(split)).toBeNull();
  });
});

describe('RECEIPT_GENESIS / commitments (RF-W40)', () => {
  it('rejects a Rating Right that commits to its own holder', async () => {
    // A right naming its own holder would let a party rate itself, which is the
    // one thing the cross pairing exists to prevent.
    const { hex, partyA } = await mintCanonical();
    const selfRated = perturbOutputs(hex, (outputs) => {
      const nft = outputs[1]?.token?.nft;
      if (nft) nft.commitment = bytes(partyA.pkhHex);
    });

    expect(recognized(selfRated)).toBeNull();
  });

  it('rejects swapped commitments, which is the same shape read backwards', async () => {
    // Both rights still commit to a party and the set is unchanged, so this is
    // the near-miss that only the pairing rule catches: each right must name
    // the *other* party, not merely a party.
    const { hex } = await mintCanonical();
    const swapped = perturbOutputs(hex, (outputs) => {
      const a = outputs[1]?.token?.nft?.commitment;
      const b = outputs[2]?.token?.nft?.commitment;
      if (outputs[1]?.token?.nft && outputs[2]?.token?.nft) {
        outputs[1].token.nft.commitment = b;
        outputs[2].token.nft.commitment = a;
      }
    });

    expect(recognized(swapped)).toBeNull();
  });

  it('rejects a receipt genesis whose two Rating Rights name the same party', async () => {
    // The one impostor that satisfies every other rule. Both Rating Rights are
    // moved to partyA's P2PKH and both commit to partyA, so the cross pairing of
    // RF-W40 holds — when there is only one party, each right correctly names the
    // other. Only "two different addresses" catches it.
    //
    // The covenant refuses this from 0.2.0 (RF-O08a), but it is a fact about the
    // outputs, so it is refused with binding off too: a genesis minted under the
    // older covenant is still on chain, and a Receipt between a party and itself
    // should not be published because of it.
    const { hex, partyA } = await mintCanonical();
    const selfReceipt = perturbOutputs(hex, (outputs) => {
      const rightA = outputs[1];
      const rightB = outputs[2];
      if (!rightA || !rightB) return;
      rightB.lockingBytecode = new Uint8Array(rightA.lockingBytecode);
      if (rightA.token?.nft && rightB.token?.nft) {
        rightA.token.nft.commitment = bytes(partyA.pkhHex);
        rightB.token.nft.commitment = bytes(partyA.pkhHex);
      }
    });

    expect(recognized(selfReceipt)).toBeNull();
  });

  it('rejects a Rating Right with an empty commitment', async () => {
    // Without a commitment the right names nobody, so the rating it authorizes
    // would have no counterparty to attach to.
    const { hex } = await mintCanonical();
    const noCommitment = perturbOutputs(hex, (outputs) => {
      const nft = outputs[1]?.token?.nft;
      if (nft) nft.commitment = EMPTY;
    });

    expect(recognized(noCommitment)).toBeNull();
  });

  it('rejects a Receipt that carries a non-empty commitment', async () => {
    // The Receipt is the shared artifact; a commitment on it would bind it to
    // one party, which is the opposite of a joint signature.
    const { hex, partyA } = await mintCanonical();
    const committed = perturbOutputs(hex, (outputs) => {
      const nft = outputs[0]?.token?.nft;
      if (nft) nft.commitment = bytes(partyA.pkhHex);
    });

    expect(recognized(committed)).toBeNull();
  });
});
