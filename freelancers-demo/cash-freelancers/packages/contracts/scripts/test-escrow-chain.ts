/**
 * Unit tests for the on-chain settlement checks in `src/escrow-chain.ts`.
 *
 * These are the pure functions (no Electrum), so the security-relevant cases —
 * a funding transaction that paid the wrong amount, a spend of funds that are
 * already gone, a recipient who was short-paid — are all reachable without a
 * node, a network, or real coins.
 *
 * Run with: pnpm --filter @cash-freelancers/contracts test:chain
 */
import { strict as assert } from "node:assert";
import {
  MINER_FEE_SATS,
  checkFundingLanded,
  checkFundingStillSpendable,
  checkSpendSettled,
  expectedPayoutSats,
  findContractUtxo
} from "../src/escrow-chain.js";

/** Structurally a cashscript `Utxo`; the checks only read these three fields,
 *  so the test does not need to construct token-aware objects. */
interface UtxoLike {
  txid: string;
  vout: number;
  satoshis: bigint;
}

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

const CONTRACT = "bchtest:qpmk3qk4qxk3h0kcxf6hc9cqj4pzqcxnhwrn9xsyc7r9hgpwxqxqsyc7r9hg";
const FUNDING_TXID = "a".repeat(64);
const RECIPIENT = "bchtest:qpvvxlktgdtrcltdc8d55tq4mw92252ra53c78eu7a";

const utxo = (txid: string, satoshis: bigint, vout = 0): UtxoLike => ({ txid, vout, satoshis });

console.log("\nexpectedPayoutSats");
test("subtracts the covenant's fixed 1000 sat fee", () => {
  assert.equal(expectedPayoutSats(40_000n), 40_000n - MINER_FEE_SATS);
  assert.equal(expectedPayoutSats(40_000), 39_000n);
});
test("refuses an amount that cannot cover the fee", () => {
  // A zero-amount payout would produce a negative output; better to fail loudly.
  assert.throws(() => expectedPayoutSats(1000n), /cannot cover/);
  assert.throws(() => expectedPayoutSats(0), /cannot cover/);
});

console.log("\nfindContractUtxo");
test("matches case-insensitively, as txids come back in mixed case", () => {
  const utxos = [utxo("A".repeat(64), 40_000n)];
  assert.ok(findContractUtxo(utxos, "a".repeat(64)));
});
test("returns undefined when the funding output is not there", () => {
  assert.equal(findContractUtxo([utxo("b".repeat(64), 40_000n)], FUNDING_TXID), undefined);
});

console.log("\ncheckFundingLanded — did the escrow actually get funded?");
test("accepts a funding tx that locked exactly the agreed amount", () => {
  const result = checkFundingLanded([utxo(FUNDING_TXID, 40_000n)], {
    txid: FUNDING_TXID,
    expectedSats: 40_000,
    contractAddress: CONTRACT
  });
  assert.equal(result.ok, true);
});
test("rejects a funding tx that locked nothing at the contract", () => {
  const result = checkFundingLanded([], {
    txid: FUNDING_TXID,
    expectedSats: 40_000,
    contractAddress: CONTRACT
  });
  assert.equal(result.ok, false);
  assert.match((result as { reason: string }).reason, /has not been funded/);
});
test("rejects an underfunded escrow — the 40k escrow funded with 1 sat", () => {
  const result = checkFundingLanded([utxo(FUNDING_TXID, 1n)], {
    txid: FUNDING_TXID,
    expectedSats: 40_000,
    contractAddress: CONTRACT
  });
  assert.equal(result.ok, false);
  assert.match((result as { reason: string }).reason, /Refusing to mark the escrow funded/);
});
test("rejects an overfunded escrow rather than silently absorbing the surplus", () => {
  const result = checkFundingLanded([utxo(FUNDING_TXID, 50_000n)], {
    txid: FUNDING_TXID,
    expectedSats: 40_000,
    contractAddress: CONTRACT
  });
  assert.equal(result.ok, false);
});

console.log("\ncheckFundingStillSpendable — pre-broadcast guard");
test("accepts an escrow still holding the agreed amount", () => {
  const result = checkFundingStillSpendable([utxo(FUNDING_TXID, 40_000n)], {
    fundingTxid: FUNDING_TXID,
    expectedSats: 40_000,
    contractAddress: CONTRACT
  });
  assert.equal(result.ok, true);
});
test("rejects a spend of an already-spent funding output (replay guard)", () => {
  const result = checkFundingStillSpendable([], {
    fundingTxid: FUNDING_TXID,
    expectedSats: 40_000,
    contractAddress: CONTRACT
  });
  assert.equal(result.ok, false);
  assert.match((result as { reason: string }).reason, /already been spent/);
});
test("rejects a spend when the escrow was drained to a different amount", () => {
  const result = checkFundingStillSpendable([utxo(FUNDING_TXID, 1_000n)], {
    fundingTxid: FUNDING_TXID,
    expectedSats: 40_000,
    contractAddress: CONTRACT
  });
  assert.equal(result.ok, false);
});

console.log("\ncheckSpendSettled — was the payout real?");
const settled = (contractUtxosAfter: UtxoLike[], credited: bigint) => ({
  contractUtxosAfter,
  recipientBalanceBefore: 100_000n,
  recipientBalanceAfter: 100_000n + credited,
  fundingTxid: FUNDING_TXID,
  expectedPayoutSats: 39_000n,
  contractAddress: CONTRACT,
  recipientAddress: RECIPIENT
});

test("accepts a spend that emptied the escrow and paid the freelancer", () => {
  assert.equal(checkSpendSettled(settled([], 39_000n)).ok, true);
});
test("accepts a spend where the recipient also consolidated other UTXOs", () => {
  // Credited more than the payout because the wallet swept other coins; still valid.
  assert.equal(checkSpendSettled(settled([], 60_000n)).ok, true);
});
test("rejects a spend that left the funding output still locked", () => {
  const result = checkSpendSettled(settled([utxo(FUNDING_TXID, 40_000n)], 39_000n));
  assert.equal(result.ok, false);
  assert.match((result as { reason: string }).reason, /did not take effect/);
});
test("rejects a spend that paid the freelancer short", () => {
  const result = checkSpendSettled(settled([], 38_999n));
  assert.equal(result.ok, false);
  assert.match((result as { reason: string }).reason, /owes 39000 sats/);
});
test("rejects a spend that paid the freelancer nothing", () => {
  assert.equal(checkSpendSettled(settled([], 0n)).ok, false);
});
test("rejects a spend that did not credit the recipient at all", () => {
  const result = checkSpendSettled({
    contractUtxosAfter: [],
    recipientBalanceBefore: 100_000n,
    recipientBalanceAfter: 100_000n,
    fundingTxid: FUNDING_TXID,
    expectedPayoutSats: 39_000n,
    contractAddress: CONTRACT,
    recipientAddress: RECIPIENT
  });
  assert.equal(result.ok, false);
  assert.match((result as { reason: string }).reason, /credited 0 sats/);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
