import {
  parseBchNetwork,
  cashaddrPrefix,
  isTestNetwork,
  type BchNetwork
} from "@cash-freelancers/shared";

/**
 * Process-wide configuration, resolved once at import time.
 *
 * `BCH_NETWORK` has no default here on purpose. Every BCH operation in this
 * service — deploying a covenant, building a release transaction, broadcasting
 * a signature — moves real value if the network is wrong, so an unset
 * `BCH_NETWORK` is a hard startup failure rather than a silent "mainnet".
 * `scripts/` and the web app use their own fallbacks, because neither can
 * fail a boot usefully.
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(
      `${name} is not set. Copy .env.example to .env and set it before starting the API.`
    );
  }
  return value.trim();
}

export const network: BchNetwork = parseBchNetwork(process.env.BCH_NETWORK);

export const port = Number(process.env.PORT ?? 4000);

export const databaseUrl = requireEnv("DATABASE_URL");

/**
 * WalletConnect project ID. The server needs it to answer `/auth/*` pairing
 * requests; the browser reads its own `NEXT_PUBLIC_` copy. It is a public
 * client credential, so it is not treated as a secret, but it is still
 * required — `SignClient.init()` throws without it.
 */
export const walletConnectProjectId = requireEnv("WALLETCONNECT_PROJECT_ID");

export const cashaddrNetwork = cashaddrPrefix(network);

export const isTestnet = isTestNetwork(network);

/** Explorer used to build human-checkable transaction links in the report. */
export const explorerUrl =
  process.env.BCH_EXPLORER_URL?.trim() ||
  (network === "mainnet" ? "https://blockchair.com/bitcoin-cash" : "https://chipnet.chaingraph.cash");

/** One line describing the active network, for the boot log. */
export function describeConfig(): string {
  return [
    `network=${network}`,
    `cashaddr prefix=${cashaddrNetwork}:`,
    `testnet=${isTestnet}`,
    `explorer=${explorerUrl}`
  ].join(" ");
}
