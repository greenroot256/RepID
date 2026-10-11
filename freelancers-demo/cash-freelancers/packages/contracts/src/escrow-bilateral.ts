import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { compileFile } from "cashc";
import {
  Contract,
  ElectrumNetworkProvider,
  TransactionBuilder,
  placeholderPublicKey,
  placeholderSignature,
  type NetworkProvider,
  type Utxo
} from "cashscript";
import type { BchNetwork } from "@cash-freelancers/shared";

// Compiled at load time from the .cash source. For production it's better
// to precompile with `cashc` at build time and version the artifact .json
// instead of compiling on every boot — left as a future improvement, not
// needed for the MVP.
const __dirname = dirname(fileURLToPath(import.meta.url));
const artifact = compileFile(join(__dirname, "escrow-bilateral.cash"));

const MINER_FEE = 1000n; // sats — has to match what the .cash file assumes

export interface EscrowBilateralParams {
  /** hash160(pubkey) of the client — not the full pubkey */
  clientPkh: Uint8Array;
  /** hash160(pubkey) of the freelancer — not the full pubkey */
  freelancerPkh: Uint8Array;
  /** nLockTime: block height or unix timestamp after which the freelancer
   *  can reclaim without the client's signature. CashScript encodes `int`
   *  arguments as `bigint`, not `number`. */
  timeout: bigint;
  /**
   * Required. This used to default to `"mainnet"`; a caller that forgot to
   * pass it would have deployed and interacted with a mainnet contract
   * while thinking it was testing. Callers resolve this from `BCH_NETWORK`.
   *
   * The string values match CashScript's `Network` enum, so this is
   * directly usable as a provider network.
   */
  network: BchNetwork;
  /** Inject a custom provider (e.g. `MockNetworkProvider` for tests).
   *  Defaults to `new ElectrumNetworkProvider(network)`. */
  provider?: NetworkProvider;
}

export type EscrowBilateralContract = ReturnType<typeof createEscrowBilateralContract>;

/**
 * Instantiates the EscrowBilateral contract and returns CashScript's
 * `Contract` object (exposes `.address`, `.getUtxos()`,
 * `.unlock.release(...)`, `.unlock.reclaim(...)`, etc.).
 */
export function createEscrowBilateralContract({
  clientPkh,
  freelancerPkh,
  timeout,
  network,
  provider = new ElectrumNetworkProvider(network)
}: EscrowBilateralParams) {
  return new Contract(artifact, [clientPkh, freelancerPkh, timeout], { provider });
}

/**
 * Builds the "release" transaction (the client approves and releases the
 * payment to the freelancer) as a WalletConnect BCH object, ready to ask
 * the client's wallet for a signature — see `signTransaction` in
 * `@cash-freelancers/wallet-connect`.
 *
 * Doesn't sign anything here: the client's pubkey and signature are left
 * as placeholders (`placeholderPublicKey`/`placeholderSignature`) that
 * the wallet fills in when signing, following the convention documented
 * at https://github.com/mainnet-pat/wc2-bch-bcr
 */
export async function buildReleaseWcTransaction(
  contract: EscrowBilateralContract,
  freelancerAddress: string,
  utxo?: Utxo
) {
  const fundingUtxo = utxo ?? (await contract.getUtxos())[0];
  if (!fundingUtxo) {
    throw new Error("The escrow contract has no funds to release");
  }

  const amount = fundingUtxo.satoshis - MINER_FEE;

  const txBuilder = new TransactionBuilder({ provider: contract.provider });
  txBuilder
    .addInput(fundingUtxo, contract.unlock.release(placeholderPublicKey(), placeholderSignature()))
    .addOutput({ to: freelancerAddress, amount });

  return txBuilder.generateWcTransactionObject({
    userPrompt: "Approve and release the payment to the freelancer"
  });
}

/**
 * Same as `buildReleaseWcTransaction`, but for the `reclaim` path: signed
 * by the freelancer, and only valid once the contract's `timeout` has
 * passed.
 *
 * `timeout` is the exact same value the contract was instantiated with (the
 * API's `EscrowBilateralParams.timeout`), and it MUST be applied to the
 * transaction's nLockTime. `reclaim` gates on `require(tx.time >= timeout)`,
 * and nLockTime defaults to 0, so a reclaim built without it can never satisfy
 * the covenant — the freelancer's escape hatch would be permanently unusable.
 * It is a parameter rather than read back off `contract` because the contract
 * only keeps the *encoded* constructor args, and the caller already has the
 * authoritative value (it derived the same timestamp to build the contract).
 */
export async function buildReclaimWcTransaction(
  contract: EscrowBilateralContract,
  freelancerAddress: string,
  timeout: bigint,
  utxo?: Utxo
) {
  const fundingUtxo = utxo ?? (await contract.getUtxos())[0];
  if (!fundingUtxo) {
    throw new Error("The escrow contract has no funds to reclaim");
  }

  // nLockTime is a 4-byte unsigned field. A timestamp that does not fit cannot
  // be enforced, and silently truncating it would either lock the freelancer
  // out forever or unlock the reclaim immediately.
  if (timeout < 0n || timeout > 0xffffffffn) {
    throw new Error(`timeout ${timeout} is out of range for a 4-byte nLockTime`);
  }
  // Below 500,000,000 Bitcoin reads nLockTime as a block height rather than a
  // timestamp, and 0 disables the gate entirely (letting the freelancer
  // reclaim instantly, which is not a timeout at all). The API stores a Unix
  // timestamp, so anything in this range is a bug upstream, not a user choice.
  if (timeout < 500000000n) {
    throw new Error(
      `timeout ${timeout} is not a usable Unix timestamp for nLockTime ` +
        `(values below 500000000 are read as a block height, and 0 disables the timeout)`
    );
  }

  const amount = fundingUtxo.satoshis - MINER_FEE;

  const txBuilder = new TransactionBuilder({ provider: contract.provider });
  txBuilder
    .addInput(fundingUtxo, contract.unlock.reclaim(placeholderPublicKey(), placeholderSignature()))
    .addOutput({ to: freelancerAddress, amount })
    .setLocktime(Number(timeout));

  return txBuilder.generateWcTransactionObject({
    userPrompt: "Claim the payment (the client's approval window expired)"
  });
}

export { artifact as escrowBilateralArtifact };

/**
 * Broadcasts an already fully-signed raw transaction (hex) to the
 * network. Kept here so apps/api doesn't need `cashscript` as a direct
 * dependency — everything BCH-network-related goes through this
 * package.
 *
 * `network` is required (it used to default to `"mainnet"`) so a
 * broadcast can never silently go to the main chain.
 */
export async function broadcastRawTransaction(
  txHex: string,
  network: BchNetwork
): Promise<string> {
  const provider = new ElectrumNetworkProvider(network);
  return provider.sendRawTransaction(txHex);
}
