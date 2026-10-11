// A structural view of the parts of a decoded BCH transaction this SDK reads.
//
// Declared structurally rather than imported from libauth on purpose. The
// recognizers depend on a handful of fields, not on a decoder's version, and a
// structural type states exactly what is being relied on: if a future libauth
// renames or retypes one of these, the SDK stops compiling at that field rather
// than silently reading `undefined` at runtime.

import { decodeTransactionBCH, hashTransaction } from '@bitauth/libauth';
import { hexToBytes, toHex } from './bytes.js';

/** The CashTokens capability of an NFT. RepID identities and receipts use none. */
export type NftCapability = 'none' | 'mutable' | 'minting';

export interface TransactionTokenNft {
  capability: NftCapability;
  commitment?: Uint8Array | null;
}

export interface TransactionToken {
  /** Display order. Not to be inverted. */
  category: Uint8Array;
  amount: bigint;
  nft?: TransactionTokenNft | null;
}

export interface TransactionOutput {
  valueSatoshis: bigint;
  lockingBytecode: Uint8Array;
  token?: TransactionToken | null;
}

export interface TransactionInput {
  /** Display order. Not to be inverted. */
  outpointTransactionHash: Uint8Array;
  outpointIndex: number;
  unlockingBytecode: Uint8Array;
}

export interface DecodedTransaction {
  inputs: TransactionInput[];
  outputs: TransactionOutput[];
}

/**
 * Decodes raw transaction hex, returning the txid alongside it.
 *
 * The txid is derived from the hex rather than looked up anywhere: the
 * recognizer needs it to build the outpoints of the Rating Rights a Receipt
 * genesis mints, so that a later rating can be attributed to the right parties
 * by spent outpoint alone.
 */
export function decodeRawTransaction(
  rawTxHex: string,
): { txid: string; tx: DecodedTransaction } {
  const binary = hexToBytes(rawTxHex);
  const decoded: unknown = decodeTransactionBCH(binary);

  // libauth signals failure by returning a string rather than throwing.
  if (typeof decoded === 'string') {
    throw new Error(`Failed to decode transaction: ${decoded}`);
  }
  if (decoded === null || typeof decoded !== 'object') {
    throw new Error('Failed to decode transaction: unexpected decoder output');
  }

  const view = decoded as Partial<DecodedTransaction>;
  if (!Array.isArray(view.inputs) || !Array.isArray(view.outputs)) {
    throw new Error('Failed to decode transaction: missing inputs or outputs');
  }

  return { txid: hashTransaction(binary), tx: view as DecodedTransaction };
}

/** The first output whose locking script starts with OP_RETURN, if any. */
export function findOpReturnOutput(tx: DecodedTransaction): TransactionOutput | undefined {
  return tx.outputs.find((output) => output.lockingBytecode[0] === 0x6a);
}

/** True when any output carries a token of the given category. */
export function categoryAppearsInOutputs(
  tx: DecodedTransaction,
  category: string,
): boolean {
  return tx.outputs.some((output) => {
    const token = output.token;
    if (!token) return false;
    return toHex(token.category) === category;
  });
}
