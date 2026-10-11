/**
 * Unit tests for the RepID contract wrappers' pure helpers.
 *
 * The byte-order test is the important one: it pins `toCategoryId` against a
 * real, known-good Chipnet transaction pair taken from the RepID reference E2E
 * data, rather than against my own assumption about CashTokens ordering. If a
 * future cashscript version changes txid reporting, this test is what should
 * fail loudly.
 *
 * Run with: pnpm --filter @cash-freelancers/contracts test:repid
 */
import { strict as assert } from "node:assert";
import { toCategoryId, assertGenesisCapableUtxo } from "../src/repid/index.js";
import { dustAmount, P2PKH_SCRIPT_LEN, P2SH32_SCRIPT_LEN } from "../src/dust.js";
import { selectFundingUtxos } from "../src/escrow-funding.js";
import { serializeWcValue } from "@cash-freelancers/shared";
import type { Utxo } from "cashscript";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${(err as Error).message.split("\n").join("\n        ")}`);
  }
}

const utxo = (txid: string, satoshis: bigint, vout = 0, token?: Utxo["token"]): Utxo => ({
  txid,
  vout,
  satoshis,
  ...(token ? { token } : {})
});

console.log("\ntoCategoryId — display order -> CashTokens internal order");
test("reproduces the real identity category from the real funding txid", () => {
  // RepID 1.2 / data_chipnet_e2e: the identity genesis tx
  // b3465406…4fd7 spends outpoint e34421c8…3675, and the identity NFT it mints
  // has on-chain category 7536a72f…4e3.
  const fundingOutpointTxid = "e34421c8f3df7617764023749067752bc483a32b50f62831d1ba37072fa73675";
  const onChainCategory = "7536a72f0737bad13128f6502ba383c42b756790742340761776dff3c82144e3";
  assert.equal(toCategoryId(fundingOutpointTxid), onChainCategory);
});
test("is an involution: reversing twice returns the original", () => {
  const txid = "b3465406476c6bbb31f04a160093ac025d401f795ee3f5d838c600bbab004fd7";
  assert.equal(toCategoryId(toCategoryId(txid)), txid);
});
test("accepts uppercase input and normalises it", () => {
  const lower = "7536a72f0737bad13128f6502ba383c42b756790742340761776dff3c82144e3";
  assert.equal(toCategoryId(lower.toUpperCase()), toCategoryId(lower));
});
test("rejects a malformed txid rather than silently producing a wrong category", () => {
  assert.throws(() => toCategoryId("not-a-txid"), /not a 32-byte hex txid/);
  assert.throws(() => toCategoryId("ab".repeat(31)), /not a 32-byte hex txid/);
  assert.throws(() => toCategoryId("zz".repeat(32)), /not a 32-byte hex txid/);
});

console.log("\nassertGenesisCapableUtxo — CashTokens genesis rule");
const CONTRACT = "bchtest:pwyqhxjg2k5gdmpvvckmr4f0f8h0k9xvpqh6jyz5r4vzc3k0j0k0k0k0k0k0k";
test("accepts a vout 0 tokenless UTXO", () => {
  assert.doesNotThrow(() => assertGenesisCapableUtxo(utxo("a".repeat(64), 50_000n, 0), CONTRACT));
});
test("rejects a UTXO at vout 1 — it can never mint a new category", () => {
  assert.throws(
    () => assertGenesisCapableUtxo(utxo("a".repeat(64), 50_000n, 1), CONTRACT),
    /requires the funding UTXO to be at vout 0/
  );
});
test("rejects a UTXO that already carries a token", () => {
  assert.throws(
    () =>
      assertGenesisCapableUtxo(
        utxo("a".repeat(64), 50_000n, 0, {
          category: "b".repeat(64),
          amount: 1n
        }),
        CONTRACT
      ),
    /must be plain BCH/
  );
});
test("names the offending outpoint so the caller can pick another UTXO", () => {
  try {
    assertGenesisCapableUtxo(utxo("c".repeat(64), 50_000n, 3), CONTRACT);
    assert.fail("expected a throw");
  } catch (err) {
    assert.match((err as Error).message, new RegExp(`c{64}:3`));
  }
});

console.log("\ndust rule — pinned to values observed in the reference's real Chipnet txs");
test("a plain P2PKH output dusts at 546 sats", () => {
  // The RepID reference's own comment calls this "~546 for the P2PKH change".
  assert.equal(dustAmount(P2PKH_SCRIPT_LEN), 546n);
});
test("a P2SH32 output carrying a 20-byte-commitment NFT dusts at 741 sats", () => {
  // The reference's own comment calls this "~741 for the P2SH32 vault with NFT".
  assert.equal(dustAmount(P2SH32_SCRIPT_LEN, "00".repeat(20)), 741n);
});
test("a P2PKH output with an NFT costs more than a plain one", () => {
  const plain = dustAmount(P2PKH_SCRIPT_LEN);
  const withNft = dustAmount(P2PKH_SCRIPT_LEN, "");
  const withCommitment = dustAmount(P2PKH_SCRIPT_LEN, "00".repeat(20));
  assert.ok(withNft > plain, `${withNft} should exceed ${plain}`);
  assert.ok(withCommitment > withNft, `${withCommitment} should exceed ${withNft}`);
});

console.log("\nselectFundingUtxos — coin selection for the funding transaction");
const plainUtxo = (sats: bigint, vout = 0): Utxo => ({ txid: "a".repeat(64), vout, satoshis: sats });

test("takes a single UTXO when one already covers the target", () => {
  const r = selectFundingUtxos([plainUtxo(1_000_000n)], 50_000n);
  assert.equal(r.utxos.length, 1);
  assert.equal(r.totalSats, 1_000_000n);
});
test("accumulates smallest-first-set, largest-first order, until covered", () => {
  const r = selectFundingUtxos(
    [plainUtxo(10_000n), plainUtxo(500_000n), plainUtxo(60_000n)],
    100_000n
  );
  assert.equal(r.utxos.length, 1, "the 500k UTXO alone should cover 100k");
  assert.equal(r.totalSats, 500_000n);
});
test("keeps adding while the total is still short", () => {
  const r = selectFundingUtxos(
    [plainUtxo(40_000n), plainUtxo(40_000n), plainUtxo(40_000n)],
    100_000n
  );
  assert.equal(r.utxos.length, 3);
  assert.equal(r.totalSats, 120_000n);
});
test("never selects a token-carrying UTXO for a plain-BCH escrow", () => {
  const r = selectFundingUtxos(
    [
      { txid: "b".repeat(64), vout: 0, satoshis: 900_000n, token: { category: "c".repeat(64), amount: 1n } },
      plainUtxo(200_000n)
    ],
    100_000n
  );
  assert.equal(r.utxos.length, 1);
  assert.equal(r.totalSats, 200_000n);
});
test("throws with an actionable message when the wallet is short", () => {
  assert.throws(
    () => selectFundingUtxos([plainUtxo(1_000n)], 50_000n),
    /Not enough spendable BCH to fund the escrow: need 50000 sats, the wallet only has 1000 sats/
  );
});
test("reports zero funds rather than looping when the wallet is empty", () => {
  assert.throws(() => selectFundingUtxos([], 1n), /the wallet only has 0 sats/);
});

console.log("\nserializeWcValue — JSON encoding of a WalletConnect transaction object");
test("encodes a bigint amount, which plain JSON.stringify refuses", () => {
  const encoded = serializeWcValue({ valueSatoshis: 31_000n }) as { valueSatoshis: string };
  assert.equal(encoded.valueSatoshis, "31000");
  assert.doesNotThrow(() => JSON.stringify(encoded));
});
test("encodes bytes as unprefixed hex, not an index-keyed object", () => {
  const encoded = serializeWcValue({ lockingBytecode: new Uint8Array([0x76, 0xa9, 0x00, 0xff]) }) as {
    lockingBytecode: string;
  };
  assert.equal(encoded.lockingBytecode, "76a900ff");
});
test("encodes an empty byte field as an empty string, not a placeholder", () => {
  const encoded = serializeWcValue({ unlockingBytecode: new Uint8Array() }) as {
    unlockingBytecode: string;
  };
  assert.equal(encoded.unlockingBytecode, "");
});
test("drops undefined properties the way JSON.stringify does", () => {
  const encoded = serializeWcValue({ txid: "aa", token: undefined }) as Record<string, unknown>;
  assert.equal("token" in encoded, false);
});
test("round-trips a whole sourceOutputs entry", () => {
  const encoded = serializeWcValue({
    lockingBytecode: new Uint8Array([0x76, 0xa9]),
    valueSatoshis: 1_000_000n,
    outpointTransactionHash: new Uint8Array([0x0e, 0x4c]),
    sequenceNumber: 4_294_967_294,
    token: undefined
  }) as Record<string, unknown>;
  assert.deepEqual(encoded, {
    lockingBytecode: "76a9",
    valueSatoshis: "1000000",
    outpointTransactionHash: "0e4c",
    sequenceNumber: 4_294_967_294
  });
});
test("never emits libauth's debugging placeholders", () => {
  const encoded = JSON.stringify(
    serializeWcValue({ lockingBytecode: new Uint8Array([0x76]), valueSatoshis: 1n })
  );
  assert.ok(!encoded.includes("<Uint8Array"), encoded);
  assert.ok(!encoded.includes("<bigint"), encoded);
});
test("survives a Buffer, which is a Uint8Array subclass", () => {
  const encoded = serializeWcValue({ b: Buffer.from([0xde, 0xad]) }) as { b: string };
  assert.equal(encoded.b, "dead");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
