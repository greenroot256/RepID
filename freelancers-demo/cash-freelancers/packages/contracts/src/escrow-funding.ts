import {
  ElectrumNetworkProvider,
  TransactionBuilder,
  placeholderP2PKHUnlocker,
  type NetworkProvider,
  type Utxo
} from "cashscript";
import type { BchNetwork } from "@cash-freelancers/shared";
import { p2pkhDust } from "./dust.js";

/**
 * Funding an escrow is the one step of the flow that is *not* a CashScript
 * covenant spend. It is an ordinary P2PKH transaction from the client that
 * locks value into the covenant's address, which the contract's `fundingTxid`
 * then gates every later step.
 *
 * The server therefore has to build it, for the same reason it builds the
 * release/reclaim objects: the browser must never hold a compiler, and the
 * private key never leaves the wallet. The wallet only ever sees a
 * WalletConnect object with placeholder signatures to fill in.
 *
 * Unlike the contract spends, there is no `.cash` file here, so the fee cannot
 * be read out of a covenant constant — it is an explicit parameter. That is
 * deliberate: on Chipnet `blockchain.estimatefee` answers 1 sat/byte for every
 * confirmation target, which is the relay floor rather than a real estimate,
 * and a transaction priced at the floor can sit unconfirmed indefinitely. The
 * caller chooses.
 */

/** Used when the caller does not specify one. Matches the covenant MINER_FEE. */
export const DEFAULT_FUNDING_FEE_SATS = 1000n;

export interface FundingUtxoSelection {
  utxos: Utxo[];
  totalSats: bigint;
}

/**
 * Picks plain-BCH UTXOs until they cover `requiredSats`, largest first.
 *
 * Largest-first rather than oldest-first (BIP-style) because Chipnet wallets in
 * this project are funded by a faucet in a single payment, so there is usually
 * exactly one UTXO and the ordering barely matters — but when there are
 * several, taking the big ones first minimises the number of inputs and
 * therefore the fee and the vsize.
 *
 * Token-carrying UTXOs are skipped: an escrow funding output must be plain BCH
 * or the later `findContractUtxo`/spend checks would have to reason about
 * tokens for no benefit.
 */
export function selectFundingUtxos(
  available: Utxo[],
  requiredSats: bigint
): FundingUtxoSelection {
  const candidates = available
    .filter((u) => !u.token && u.satoshis > 0n)
    .sort((a, b) => (b.satoshis > a.satoshis ? 1 : b.satoshis < a.satoshis ? -1 : 0));

  const chosen: Utxo[] = [];
  let total = 0n;
  for (const utxo of candidates) {
    chosen.push(utxo);
    total += utxo.satoshis;
    if (total >= requiredSats) break;
  }

  if (total < requiredSats) {
    throw new Error(
      `Not enough spendable BCH to fund the escrow: need ${requiredSats} sats, ` +
        `the wallet only has ${total} sats across ${chosen.length} plain-BCH UTXO(s). ` +
        `Top up the wallet, or consolidate its UTXOs into one.`
    );
  }
  return { utxos: chosen, totalSats: total };
}

/**
 * Builds the funding transaction as a WalletConnect BCH object for the client
 * to sign.
 *
 * Output layout:
 *   0 — the escrow covenant address, exactly `amountSats`
 *   1 — change back to the client (omitted when it would be dust)
 *
 * The change output is skipped rather than emitted as dust because the relay
 * policy would drop a dust output and the value would silently go to the
 * miner instead of the client. Dropping it is the honest option: the client
 * gets a slightly higher fee rather than a surprise.
 */
export async function buildFundingWcTransaction(input: {
  clientAddress: string;
  contractAddress: string;
  amountSats: number;
  utxos: Utxo[];
  feeSats?: bigint;
  network: BchNetwork;
  provider?: NetworkProvider;
}): Promise<{ wcTransactionObject: unknown; fundingUtxos: Utxo[]; feeSats: bigint }> {
  const { clientAddress, contractAddress, amountSats, utxos, network } = input;
  const feeSats = input.feeSats ?? DEFAULT_FUNDING_FEE_SATS;
  const provider = input.provider ?? new ElectrumNetworkProvider(network);

  if (!Number.isSafeInteger(amountSats) || amountSats <= 0) {
    throw new Error(`amountSats must be a positive integer, got ${amountSats}`);
  }
  if (feeSats < 0n) {
    throw new Error(`feeSats cannot be negative, got ${feeSats}`);
  }

  const amount = BigInt(amountSats);
  const { utxos: fundingUtxos, totalSats } = selectFundingUtxos(utxos, amount + feeSats);
  const change = totalSats - amount - feeSats;

  // An input below dust cannot be spent, so if the selected inputs only barely
  // cover the amount there is no room for change and none is created.
  const keepChange = change >= p2pkhDust();

  const builder = new TransactionBuilder({ provider });
  for (const utxo of fundingUtxos) {
    builder.addInput(utxo, placeholderP2PKHUnlocker(clientAddress));
  }
  builder.addOutput({ to: contractAddress, amount });
  if (keepChange) {
    builder.addOutput({ to: clientAddress, amount: change });
  }

  const wcTransactionObject = await builder.generateWcTransactionObject({
    userPrompt: "Fund the escrow (funds are locked until you release them)"
  });

  return { wcTransactionObject, fundingUtxos, feeSats };
}

/**
 * Gathers the client's plain-BCH UTXOs so the caller can report whether the
 * wallet can even afford the escrow before building anything.
 */
export async function fetchSpendableUtxos(
  address: string,
  network: BchNetwork,
  provider?: NetworkProvider
): Promise<Utxo[]> {
  const p = provider ?? new ElectrumNetworkProvider(network);
  return p.getUtxos(address);
}
