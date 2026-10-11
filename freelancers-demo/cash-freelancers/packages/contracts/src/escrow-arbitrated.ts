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

const __dirname = dirname(fileURLToPath(import.meta.url));
const artifact = compileFile(join(__dirname, "escrow-arbitrated.cash"));

const MINER_FEE = 1000n; // sats — has to match what the .cash file assumes

export interface EscrowArbitratedParams {
  /** hash160(pubkey) of the client — not the full pubkey */
  clientPkh: Uint8Array;
  /** hash160(pubkey) of the freelancer — not the full pubkey */
  freelancerPkh: Uint8Array;
  /** hash160(pubkey) of the arbiter — not the full pubkey */
  arbiterPkh: Uint8Array;
  /** Required — see the note on `EscrowBilateralParams.network`. */
  network: BchNetwork;
  /** Inject a custom provider (e.g. `MockNetworkProvider` for tests).
   *  Defaults to `new ElectrumNetworkProvider(network)`. */
  provider?: NetworkProvider;
}

export type EscrowArbitratedContract = ReturnType<typeof createEscrowArbitratedContract>;

/**
 * Instantiates the EscrowArbitrated contract and returns CashScript's
 * `Contract` object (exposes `.address`, `.getUtxos()`,
 * `.unlock.spend(...)`).
 */
export function createEscrowArbitratedContract({
  clientPkh,
  freelancerPkh,
  arbiterPkh,
  network,
  provider = new ElectrumNetworkProvider(network)
}: EscrowArbitratedParams) {
  return new Contract(artifact, [clientPkh, freelancerPkh, arbiterPkh], { provider });
}

/**
 * Builds the `spend` transaction as a WalletConnect BCH object, with
 * BOTH signer slots left as placeholders — ready to kick off the
 * two-step co-signing flow described in the package README:
 *
 *   1. The first of the two co-signers (whoever is available first —
 *      typically the arbiter once they've ruled on a dispute) signs
 *      this object with their wallet. A WC2-BCH-compliant wallet is
 *      expected to fill in only the placeholder slot that matches a key
 *      it holds and leave the other slot's placeholder untouched.
 *   2. The resulting partially-signed transaction — not this original
 *      placeholder object — is sent to the second co-signer's wallet to
 *      complete and broadcast.
 *
 * This two-step flow hasn't been tested against real wallets (unlike
 * EscrowBilateral's release/reclaim, which was validated end-to-end
 * with a simulated provider) — see the README for details and caveats.
 */
export async function buildSpendWcTransaction(
  contract: EscrowArbitratedContract,
  destinationAddress: string,
  utxo?: Utxo
) {
  const fundingUtxo = utxo ?? (await contract.getUtxos())[0];
  if (!fundingUtxo) {
    throw new Error("The escrow contract has no funds to spend");
  }

  const amount = fundingUtxo.satoshis - MINER_FEE;

  const txBuilder = new TransactionBuilder({ provider: contract.provider });
  txBuilder
    .addInput(
      fundingUtxo,
      contract.unlock.spend(
        placeholderPublicKey(),
        placeholderSignature(),
        placeholderPublicKey(),
        placeholderSignature()
      )
    )
    .addOutput({ to: destinationAddress, amount });

  return txBuilder.generateWcTransactionObject({
    userPrompt: "Co-sign the escrow resolution (2 of 3 required)"
  });
}

export { artifact as escrowArbitratedArtifact };
