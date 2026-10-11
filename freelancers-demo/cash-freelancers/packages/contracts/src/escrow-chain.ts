import { ElectrumNetworkProvider, type NetworkProvider, type Utxo } from "cashscript";
import type { BchNetwork } from "@cash-freelancers/shared";

/**
 * On-chain verification of escrow state transitions.
 *
 * The API's job when a transaction is broadcast is to decide *whether it
 * actually did the thing it was supposed to do* before recording that it did.
 * Until now it broadcast whatever hex it was handed and stored the resulting
 * txid, so a caller could mark an escrow `funded` (or `released`) with a
 * transaction that paid the contract nothing, or paid the wrong party.
 *
 * These checks deliberately verify against **chain state** rather than against
 * the bytes of the submitted transaction:
 *
 *  - we never have to hand-roll a BCH transaction parser (easy to get subtly
 *    wrong, and a parser bug would silently accept a bad transaction), and
 *  - a check can only pass if the network actually accepted and indexed the
 *    transaction, which is the property we actually care about.
 *
 * Electrum indexes unconfirmed transactions, so these hold immediately after a
 * successful broadcast — no confirmation wait required.
 */

/** The subset of a CashScript `Contract` these checks need. Structural so
 *  that tests can pass a plain object instead of a real contract. */
export interface VerifiableContract {
  address: string;
  getUtxos(): Promise<Utxo[]>;
  provider: NetworkProvider;
}

export const MINER_FEE_SATS = 1000n;

/** Net payout the freelancer receives on release/reclaim. The covenant
 *  hard-codes a 1000 sat fee, so this is exact, not an estimate. */
export function expectedPayoutSats(escrowedSats: number | bigint): bigint {
  const total = BigInt(escrowedSats);
  if (total <= MINER_FEE_SATS) {
    throw new Error(
      `An escrow of ${total} sats cannot cover the ${MINER_FEE_SATS} sat miner fee; it would pay a negative amount`
    );
  }
  return total - MINER_FEE_SATS;
}

type Check = { ok: true } | { ok: false; reason: string };

/** Finds the contract's UTXO created by `txid`. Pure so it can be tested
 *  without a network. */
export function findContractUtxo(utxos: Utxo[], txid: string): Utxo | undefined {
  const wanted = txid.toLowerCase();
  return utxos.find((u) => u.txid.toLowerCase() === wanted);
}

/**
 * Confirms `txid` locked exactly `expectedSats` at the escrow contract.
 * Used after broadcasting a funding transaction.
 */
export function checkFundingLanded(
  utxos: Utxo[],
  input: { txid: string; expectedSats: number; contractAddress: string }
): Check {
  const landed = findContractUtxo(utxos, input.txid);
  if (!landed) {
    return {
      ok: false,
      reason:
        `Transaction ${input.txid} did not lock any output at the escrow contract ` +
        `${input.contractAddress}. The escrow has not been funded.`
    };
  }
  if (landed.satoshis !== BigInt(input.expectedSats)) {
    return {
      ok: false,
      reason:
        `Transaction ${input.txid} locked ${landed.satoshis} sats at the escrow contract, ` +
        `but the agreed amount is ${input.expectedSats} sats. Refusing to mark the escrow funded.`
    };
  }
  return { ok: true };
}

/**
 * Pre-broadcast guard for a spend of the escrow: the funding UTXO must still be
 * locked at the contract, and still hold the agreed amount. Without this, a
 * replayed or stale release transaction would be "verified" against a contract
 * that no longer holds the funds.
 */
export function checkFundingStillSpendable(
  utxos: Utxo[],
  input: { fundingTxid: string; expectedSats: number; contractAddress: string }
): Check {
  const current = findContractUtxo(utxos, input.fundingTxid);
  if (!current) {
    return {
      ok: false,
      reason:
        `Escrow ${input.contractAddress} no longer holds the funding output ${input.fundingTxid}; ` +
        `it has already been spent, or was never funded.`
    };
  }
  if (current.satoshis !== BigInt(input.expectedSats)) {
    return {
      ok: false,
      reason:
        `Escrow ${input.contractAddress} holds ${current.satoshis} sats in ${input.fundingTxid}, ` +
        `but the agreed amount is ${input.expectedSats} sats.`
    };
  }
  return { ok: true };
}

/**
 * Confirms a spend actually settled: the funding UTXO is gone from the
 * contract, and the recipient's balance grew by at least the expected payout.
 *
 * Balances rather than a specific output are deliberate — the recipient may
 * have consolidated with other UTXOs in the same broadcast, and requiring an
 * exact output match would reject a legitimately correct transaction.
 */
export function checkSpendSettled(input: {
  contractUtxosAfter: Utxo[];
  recipientBalanceBefore: bigint;
  recipientBalanceAfter: bigint;
  fundingTxid: string;
  expectedPayoutSats: bigint;
  contractAddress: string;
  recipientAddress: string;
}): Check {
  if (findContractUtxo(input.contractUtxosAfter, input.fundingTxid)) {
    return {
      ok: false,
      reason: `Escrow ${input.contractAddress} still holds ${input.fundingTxid}; the spend did not take effect.`
    };
  }
  const credited = input.recipientBalanceAfter - input.recipientBalanceBefore;
  if (credited < input.expectedPayoutSats) {
    return {
      ok: false,
      reason:
        `${input.recipientAddress} was credited ${credited} sats, but the escrow owes ` +
        `${input.expectedPayoutSats} sats.`
    };
  }
  return { ok: true };
}

// --- network wrappers -------------------------------------------------------

function providerFor(network: BchNetwork, contract: VerifiableContract): NetworkProvider {
  return contract.provider ?? new ElectrumNetworkProvider(network);
}

export async function readContractUtxos(
  contract: VerifiableContract,
  network: BchNetwork
): Promise<Utxo[]> {
  return contract.getUtxos();
}

export async function readAddressBalance(
  address: string,
  network: BchNetwork,
  contract?: VerifiableContract
): Promise<bigint> {
  const provider = contract ? providerFor(network, contract) : new ElectrumNetworkProvider(network);
  const utxos = await provider.getUtxos(address);
  return utxos.reduce((sum, u) => sum + u.satoshis, 0n);
}

/** Broadcasts, then confirms the contract actually received the agreed amount.
 *  Throws if the transaction did not land as specified. */
export async function broadcastAndVerifyFunding(input: {
  contract: VerifiableContract;
  network: BchNetwork;
  signedTransactionHex: string;
  expectedSats: number;
}): Promise<string> {
  const txid = await input.contract.provider.sendRawTransaction(input.signedTransactionHex);
  const utxos = await readContractUtxos(input.contract, input.network);
  const result = checkFundingLanded(utxos, {
    txid,
    expectedSats: input.expectedSats,
    contractAddress: input.contract.address
  });
  if (!result.ok) throw new Error(result.reason);
  return txid;
}

/** Verifies the escrow still holds its funding before a spend is attempted.
 *  Returns the funding UTXO so callers can pass it to the builder. */
export async function assertFundingStillSpendable(input: {
  contract: VerifiableContract;
  network: BchNetwork;
  fundingTxid: string;
  expectedSats: number;
}): Promise<Utxo> {
  const utxos = await readContractUtxos(input.contract, input.network);
  const result = checkFundingStillSpendable(utxos, {
    fundingTxid: input.fundingTxid,
    expectedSats: input.expectedSats,
    contractAddress: input.contract.address
  });
  if (!result.ok) throw new Error(result.reason);
  return findContractUtxo(utxos, input.fundingTxid)!;
}

/** Broadcasts a spend, then confirms the funding output was consumed and the
 *  recipient was actually paid. Returns the txid. */
export async function broadcastAndVerifySpend(input: {
  contract: VerifiableContract;
  network: BchNetwork;
  signedTransactionHex: string;
  fundingTxid: string;
  recipientAddress: string;
  expectedPayoutSats: bigint;
  recipientBalanceBefore: bigint;
}): Promise<string> {
  const txid = await input.contract.provider.sendRawTransaction(input.signedTransactionHex);
  const [contractUtxosAfter, recipientBalanceAfter] = await Promise.all([
    readContractUtxos(input.contract, input.network),
    readAddressBalance(input.recipientAddress, input.network, input.contract)
  ]);
  const result = checkSpendSettled({
    contractUtxosAfter,
    recipientBalanceBefore: input.recipientBalanceBefore,
    recipientBalanceAfter,
    fundingTxid: input.fundingTxid,
    expectedPayoutSats: input.expectedPayoutSats,
    contractAddress: input.contract.address,
    recipientAddress: input.recipientAddress
  });
  if (!result.ok) throw new Error(result.reason);
  return txid;
}
