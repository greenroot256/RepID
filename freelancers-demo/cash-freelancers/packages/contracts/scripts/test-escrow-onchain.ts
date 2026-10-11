/**
 * Real on-chain end-to-end check for the bilateral escrow, on Chipnet.
 *
 * The other suites in this package are pure-function tests over fake UTXO sets,
 * and `smoke:authz` only exercises HTTP authorization against database fixtures.
 * Neither ever puts value into a covenant, so "the escrow works" was never
 * actually demonstrated against a node. This script does exactly that with the
 * funded wallets in data/test-wallets.json:
 *
 *   1. compile the bilateral covenant for the client/freelancer pair
 *   2. broadcast a real funding transaction from the client into the covenant
 *   3. wait for it to be mined (an unconfirmed input cannot be spent)
 *   4. broadcast a real release transaction, signed locally
 *   5. assert the payout reached the freelancer and the covenant is empty
 *
 * Run with: pnpm --filter @cash-freelancers/contracts test:onchain
 *
 * It spends real (faucet) coins and the client wallet keeps the change, so it
 * is repeatable. It is a Chipnet-only safety check: the network comes from
 * BCH_NETWORK and the script refuses to run anywhere else.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ElectrumNetworkProvider,
  SignatureTemplate,
  TransactionBuilder
} from "cashscript";
import { parseBchNetwork } from "@cash-freelancers/shared";
import { createEscrowBilateralContract } from "../src/escrow-bilateral.js";
import { fetchSpendableUtxos, selectFundingUtxos } from "../src/escrow-funding.js";
import { checkFundingLanded, checkSpendSettled } from "../src/escrow-chain.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");
const walletsPath = join(repoRoot, "data", "test-wallets.json");

/** Amount locked into the covenant. Must exceed the 1000 sat covenant fee. */
const AMOUNT_SATS = 40_000;
const FUNDING_FEE_SATS = 1000n;
/** Chipnet blocks are slow enough that a fixed sleep would be a coin flip. */
const CONFIRM_TIMEOUT_MS = 15 * 60_000;
const POLL_MS = 10_000;

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Polls until `probe` returns a value, or the timeout expires. Used instead of
 * a fixed sleep so the script is neither flaky on a slow relay nor needlessly
 * slow on a fast one.
 */
async function waitFor<T>(
  label: string,
  probe: () => Promise<T | null>,
  timeoutMs: number
): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  for (;;) {
    const value = await probe();
    if (value !== null) return value;
    if (Date.now() > deadline) {
      console.log(`\n  timed out after ${Math.round(timeoutMs / 1000)}s waiting for ${label}`);
      return null;
    }
    attempt++;
    console.log(`  … ${label} (${Math.round((attempt * POLL_MS) / 1000)}s elapsed)`);
    await sleep(POLL_MS);
  }
}

async function main() {
  const network = parseBchNetwork(process.env.BCH_NETWORK, "chipnet");
  if (network !== "chipnet") {
    console.error(`Refusing to spend coins on ${network}: this script is Chipnet-only.`);
    process.exit(1);
  }

  if (!existsSync(walletsPath)) {
    console.error(`No wallet file at ${walletsPath}. Run generate:wallets first.`);
    process.exit(1);
  }

  const store = JSON.parse(readFileSync(walletsPath, "utf8")) as {
    network: string;
    wallets: { role: string; address: string; privateKeyHex: string; publicKeyHex: string; pkhHex: string }[];
  };
  const byRole = (role: string) => {
    const w = store.wallets.find((x) => x.role === role);
    if (!w) throw new Error(`No ${role} wallet in ${walletsPath}`);
    return w;
  };
  const client = byRole("client");
  const freelancer = byRole("freelancer");

  const provider = new ElectrumNetworkProvider(network);
  const clientSig = new SignatureTemplate(client.privateKeyHex);
  const clientPub = Uint8Array.from(Buffer.from(client.publicKeyHex, "hex"));

  const clientBalanceBefore = (await provider.getUtxos(client.address)).reduce(
    (s, u) => s + u.satoshis,
    0n
  );
  const freelancerBalanceBefore = (await provider.getUtxos(freelancer.address)).reduce(
    (s, u) => s + u.satoshis,
    0n
  );
  console.log(`Network: ${network}\n`);
  console.log(`  client     ${client.address}`);
  console.log(`  freelancer ${freelancer.address}`);
  console.log(`  client balance before: ${clientBalanceBefore} sats\n`);

  // The covenant is addressed by the hash of its compiled script plus the two
  // pkhs, so a fresh escrow is a fresh address every time.
  const contract = createEscrowBilateralContract({
    clientPkh: Uint8Array.from(Buffer.from(client.pkhHex, "hex")),
    freelancerPkh: Uint8Array.from(Buffer.from(freelancer.pkhHex, "hex")),
    timeout: BigInt(Math.floor(Date.now() / 1000) + 3600),
    network,
    provider
  });
  console.log(`  covenant   ${contract.address}\n`);

  // 1. Fund the covenant with a real, locally signed P2PKH transaction.
  const clientUtxos = await fetchSpendableUtxos(client.address, network, provider);
  const { utxos: fundingInputs, totalSats } = selectFundingUtxos(
    clientUtxos,
    BigInt(AMOUNT_SATS) + FUNDING_FEE_SATS
  );
  const change = totalSats - BigInt(AMOUNT_SATS) - FUNDING_FEE_SATS;

  const fundingBuilder = new TransactionBuilder({ provider });
  for (const utxo of fundingInputs) {
    fundingBuilder.addInput(utxo, clientSig.unlockP2PKH());
  }
  fundingBuilder
    .addOutput({ to: contract.address, amount: BigInt(AMOUNT_SATS) })
    .addOutput({ to: client.address, amount: change });

  const fundingHex = await fundingBuilder.build();
  const fundingTxid = await provider.sendRawTransaction(fundingHex);
  console.log(`  funding txid: ${fundingTxid}\n`);

  // 2. Wait for the funding output to exist at the covenant at all.
  const seenUtxo = await waitFor(
    "the funding output to appear at the covenant",
    async () => (await contract.getUtxos()).find((u) => u.txid === fundingTxid) ?? null,
    120_000
  );
  if (!seenUtxo) {
    check("the funding output reached the covenant", false);
    return;
  }
  check("the funding output reached the covenant", true, `${seenUtxo.satoshis} sats`);
  check(
    "the covenant holds exactly the agreed amount",
    seenUtxo.satoshis === BigInt(AMOUNT_SATS),
    `${seenUtxo.satoshis} vs ${AMOUNT_SATS}`
  );

  // 3. It must be mined before it can be spent, so wait for a confirmation.
  const tipBefore = await provider.getBlockHeight();
  const mined = await waitFor(
    "the funding transaction to be mined",
    async () => {
      const response = await provider.performRequest("blockchain.transaction.get", fundingTxid, true);
      // The mined height is reported inconsistently across Electrum servers —
      // this one omits it even though it reports confirmations, which is why
      // "block undefined" used to be logged. The confirmation count is the field
      // that is actually reliable, and the height is derived from it below.
      const tx = response as { confirmations?: number; height?: number; blockheight?: number };
      return typeof tx.confirmations === "number" && tx.confirmations > 0 ? tx : null;
    },
    CONFIRM_TIMEOUT_MS
  );
  if (!mined) {
    check("the funding transaction was mined", false);
    return;
  }
  // The tip is the height of the newest block, and a transaction with N
  // confirmations was mined N blocks back, so the height is recoverable without
  // the server having to report it.
  const height = mined.height ?? mined.blockheight ?? tipBefore - mined.confirmations! + 1;
  check(
    "the funding transaction was mined",
    true,
    `block ${height}, ${mined.confirmations} confirmation(s), tip was ${tipBefore}`
  );

  // 4. Re-run the same guard the API uses before it will accept a funding tx.
  const landed = checkFundingLanded(await contract.getUtxos(), {
    txid: fundingTxid,
    expectedSats: AMOUNT_SATS,
    contractAddress: contract.address
  });
  check("the API's funding guard accepts what actually happened", landed.ok, landed.reason);

  // 5. Release. cashscript computes the sighash and signature lazily when a
  //    SignatureTemplate is passed where a signature is expected, so this is the
  //    local equivalent of the client wallet signing the release object.
  const spendable = (await contract.getUtxos()).find((u) => u.txid === fundingTxid);
  if (!spendable) {
    check("the funding output is still spendable", false);
    return;
  }
  const payout = spendable.satoshis - 1000n;

  const releaseBuilder = new TransactionBuilder({ provider });
  releaseBuilder
    .addInput(spendable, contract.unlock.release(clientPub, clientSig))
    .addOutput({ to: freelancer.address, amount: payout });
  const releaseHex = await releaseBuilder.build();
  const releaseTxid = await provider.sendRawTransaction(releaseHex);
  console.log(`\n  release txid: ${releaseTxid}\n`);

  // 6. The freelancer's balance must actually grow by the payout. This is the
  //    assertion the smoke suite could not make, because it never broadcast.
  const grew = await waitFor(
    "the freelancer to be credited",
    async () => {
      const after = (await provider.getUtxos(freelancer.address)).reduce((s, u) => s + u.satoshis, 0n);
      return after > freelancerBalanceBefore ? after : null;
    },
    CONFIRM_TIMEOUT_MS
  );
  if (grew === null) {
    check("the freelancer was paid", false, `still at ${freelancerBalanceBefore} sats`);
    return;
  }
  check(
    "the freelancer was paid",
    true,
    `${freelancerBalanceBefore} -> ${grew} sats (+${grew - freelancerBalanceBefore})`
  );
  check(
    "the payout matches the amount minus the covenant fee",
    grew - freelancerBalanceBefore === payout,
    `expected +${payout}, got +${grew - freelancerBalanceBefore}`
  );

  const settled = checkSpendSettled({
    contractUtxosAfter: await contract.getUtxos(),
    recipientBalanceBefore: freelancerBalanceBefore,
    recipientBalanceAfter: grew,
    fundingTxid,
    recipientAddress: freelancer.address,
    expectedPayoutSats: payout
  } as Parameters<typeof checkSpendSettled>[0]);
  check("the API's settlement guard accepts what actually happened", settled.ok, settled.reason);

  const emptied = await waitFor(
    "the covenant to be empty",
    async () => ((await contract.getUtxos()).length === 0 ? true : null),
    120_000
  );
  check("the covenant is empty after the release", emptied === true);
}

main()
  .then(() => {
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
