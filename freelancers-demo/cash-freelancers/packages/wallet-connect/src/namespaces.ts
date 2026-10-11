// The "WC2-BCH" convention: the WalletConnect v2 profile for Bitcoin Cash
// that Cashonize, Paytaca and Zapit support today. It is not (yet) a
// formal BCH standard — it's a community convention documented by its
// author here: https://github.com/mainnet-pat/wc2-bch-bcr
// It may keep evolving; worth checking that source from time to time.

import type { BchNetwork } from "@cash-freelancers/shared";

export type { BchNetwork };

// Chain identifiers in CAIP-2 format.
//
// The spec defines exactly three BCH chains, and Chipnet is not one of
// them:
//
//   bch:bitcoincash   mainnet
//   bch:bchtest       testnet
//   bch:bchreg        regtest
//
// There is no `bch:chipnet`. Chipnet and testnet therefore have to share
// `bch:bchtest` here, which means WalletConnect alone can never prove
// which of the two a session is on. Every transaction that comes back
// from a wallet must be verified against the Electrum node for the
// intended network before it is treated as final — see
// `assertTxidOnNetwork` in the API. The network actually used comes from
// `BCH_NETWORK`, not from the pairing.
const CHAIN_BY_NETWORK: Record<BchNetwork, string> = {
  mainnet: "bch:bitcoincash",
  chipnet: "bch:bchtest",
  testnet3: "bch:bchtest",
  testnet4: "bch:bchtest",
  regtest: "bch:bchreg",
  mocknet: "bch:bchreg",
};

export function bchChainId(network: BchNetwork): string {
  return CHAIN_BY_NETWORK[network];
}

export function bchRequiredNamespaces(network: BchNetwork) {
  return {
    bch: {
      chains: [CHAIN_BY_NETWORK[network]],
      methods: ["bch_getAddresses", "bch_signTransaction", "bch_signMessage"],
      events: ["addressesChanged"]
    }
  };
}
