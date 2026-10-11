/**
 * Regression test for BUG-12: the bilateral escrow's `reclaim` path used to
 * be unsatisfiable.
 *
 * `reclaim` gates on `require(tx.time >= timeout)`, and nLockTime defaults to
 * 0. `buildReclaimWcTransaction` never called `setLocktime`, so every reclaim
 * transaction failed the covenant — the freelancer's escape hatch after the
 * client's approval window expired could never be used.
 *
 * This exercises the three boundary cases that matter, all against the real
 * shipped wrapper and the real covenant:
 *
 *   - locktime omitted      -> must be REJECTED (this is the pre-fix bug)
 *   - locktime = timeout-1  -> must be REJECTED (one second early)
 *   - locktime = timeout    -> must be ACCEPTED (boundary is inclusive)
 *   - locktime = timeout+1  -> must be ACCEPTED
 *
 * plus two structural checks on the transaction the builder actually returns:
 * that its nLockTime is the timeout, and that an out-of-range timeout is
 * refused rather than silently truncated.
 *
 * Run with: pnpm --filter @cash-freelancers/contracts simulate:reclaim
 */
import {
  MockNetworkProvider,
  SignatureTemplate,
  TransactionBuilder,
  randomUtxo,
  type Utxo
} from "cashscript";
import {
  secp256k1,
  hash160,
  encodeCashAddress,
  CashAddressType
} from "@bitauth/libauth";
import { createEscrowBilateralContract, buildReclaimWcTransaction } from "../src/escrow-bilateral.js";
import { parseBchNetwork, cashaddrPrefix } from "@cash-freelancers/shared";

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function randomKeypair() {
  let priv: Uint8Array;
  do {
    priv = crypto.getRandomValues(new Uint8Array(32));
  } while (!secp256k1.validatePrivateKey(priv));
  const pub = secp256k1.derivePublicKeyCompressed(priv) as Uint8Array;
  return { priv, pub, pkh: hash160(pub) };
}

const MINER_FEE = 1000n;
const ESCROW_SATS = 80_000n;

async function main() {
  const network = parseBchNetwork(process.env.BCH_NETWORK, "mainnet");

  const client = randomKeypair();
  const freelancer = randomKeypair();

  // A realistic Unix timestamp. Comfortably above the 500,000,000 threshold
  // that separates "block height" from "timestamp" in Bitcoin's nLockTime
  // encoding, and small enough for the 4-byte field.
  const timeout = 1_800_000_000n;

  const provider = new MockNetworkProvider();
  provider.network = network;

  const contract = createEscrowBilateralContract({
    clientPkh: client.pkh,
    freelancerPkh: freelancer.pkh,
    timeout,
    network,
    provider
  });

  const freelancerAddress = encodeCashAddress({
    payload: hash160(freelancer.pub),
    prefix: cashaddrPrefix(network),
    type: CashAddressType.p2pkh
  }).address;

  console.log(`Network:    ${network}`);
  console.log(`Contract:   ${contract.address}`);
  console.log(`Timeout:    ${timeout} (unix timestamp)\n`);

  /**
   * Builds a fully-signed reclaim with an explicit nLockTime, bypassing
   * `buildReclaimWcTransaction` so each case can be set by hand. `null`
   * means "do not call setLocktime", which is exactly what the old code did.
   *
   * `send()` rather than `build()` on purpose: `build()` only assembles the
   * transaction, while `send()` runs the covenant's VM, so a failing
   * `require` surfaces here. (Verified: a `release` signed by the freelancer
   * builds fine but is rejected by `send()` at escrow-bilateral.cash:19.)
   */
  async function attemptReclaim(locktime: bigint | null): Promise<{ ok: boolean; reason: string }> {
    const utxo: Utxo = { ...randomUtxo(), satoshis: ESCROW_SATS };
    provider.addUtxo(contract.address, utxo);

    const builder = new TransactionBuilder({ provider });
    builder
      .addInput(
        utxo,
        contract.unlock.reclaim(freelancer.pub, new SignatureTemplate(freelancer.priv))
      )
      .addOutput({ to: freelancerAddress, amount: ESCROW_SATS - MINER_FEE });

    if (locktime !== null) builder.setLocktime(Number(locktime));

    try {
      await builder.send();
      return { ok: true, reason: "" };
    } catch (err) {
      return { ok: false, reason: (err as Error).message };
    }
  }

  console.log("covenant boundary (nLockTime vs timeout)");

  const noLocktime = await attemptReclaim(null);
  check(
    "a reclaim with no nLockTime is rejected (the BUG-12 behaviour)",
    !noLocktime.ok,
    noLocktime.ok ? "unexpectedly accepted" : noLocktime.reason
  );

  const early = await attemptReclaim(timeout - 1n);
  check(
    "a reclaim one second before the timeout is rejected",
    !early.ok,
    early.ok ? "unexpectedly accepted" : early.reason
  );

  const exact = await attemptReclaim(timeout);
  check("a reclaim exactly at the timeout is accepted", exact.ok, exact.reason);

  const late = await attemptReclaim(timeout + 1n);
  check("a reclaim after the timeout is accepted", late.ok, late.reason);

  console.log("\nthe transaction buildReclaimWcTransaction returns");

  const utxo: Utxo = { ...randomUtxo(), satoshis: ESCROW_SATS };
  provider.addUtxo(contract.address, utxo);
  const wc = await buildReclaimWcTransaction(contract, freelancerAddress, timeout, utxo);

  // WcTransactionObject.transaction is already a decoded TransactionCommon,
  // not raw bytes — encodeTransactionCommon() is what turns it back into hex.
  const tx = wc.transaction;
  check(
    "its nLockTime equals the contract timeout",
    BigInt(tx.locktime) === timeout,
    `locktime=${tx.locktime}, expected ${timeout}`
  );
  check(
    "its transaction version is 2 so nodes enforce the nLockTime",
    tx.version === 2,
    `version=${tx.version}`
  );
  check(
    "it still pays the freelancer the escrow minus the fee",
    tx.outputs.length === 1 && BigInt(tx.outputs[0].valueSatoshis) === ESCROW_SATS - MINER_FEE,
    `outputs=${tx.outputs.length} value=${tx.outputs[0]?.valueSatoshis}`
  );

  console.log("\nout-of-range timeouts are refused, not truncated");

  for (const [label, bad] of [
    ["a block-height-sized value", 1000n],
    ["zero", 0n],
    ["a value beyond 2^32-1", 0x1_0000_0000n]
  ] as const) {
    try {
      await buildReclaimWcTransaction(contract, freelancerAddress, bad, utxo);
      check(`buildReclaimWcTransaction rejects ${label} (${bad})`, false, "it accepted it");
    } catch {
      check(`buildReclaimWcTransaction rejects ${label} (${bad})`, true);
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error("Simulation failed:", err);
  process.exit(1);
});
