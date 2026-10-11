// App/dapp-side types for the WC2-BCH convention. They mirror what
// https://github.com/mainnet-pat/wc2-bch-bcr documents — the connected
// wallet (Cashonize/Paytaca/Zapit) is the one that interprets them.

import type { BchNetwork } from "./namespaces.js";

export interface WalletSession {
  topic: string;
  address: string;
  /**
   * The network the session was established for, copied from
   * `WalletConnectConfig.network` (i.e. `BCH_NETWORK`). It is NOT
   * something the wallet reports and NOT something derived from the
   * address prefix — see the note in `namespaces.ts` about Chipnet and
   * testnet sharing `bch:bchtest`.
   */
  network: BchNetwork;
}

// Structural shape of the object returned by
// `TransactionBuilder.generateWcTransactionObject()` from `cashscript`.
// Typed here instead of importing `cashscript` directly so this package
// (transport/pairing) doesn't depend on the contracts package — whoever
// builds the transaction (`@cash-freelancers/contracts`) constructs it
// and hands it to `signTransaction` as-is.
export interface WcTransactionObjectLike {
  transaction: unknown;
  sourceOutputs: unknown[];
  broadcast?: boolean;
  userPrompt?: string;
}

export interface WcSignTransactionResponse {
  signedTransaction: string;
  signedTransactionHash: string;
}

export interface WcSignMessageRequest {
  message: string;
  userPrompt?: string;
}

export type WcSignMessageResponse = string;
