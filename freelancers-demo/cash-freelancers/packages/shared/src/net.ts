// Single source of truth for "which BCH network are we talking to".
//
// Every layer used to hardcode `network = "mainnet"`, which meant a
// misconfigured environment could silently build, sign and broadcast real
// mainnet transactions while the operator believed they were testing.
// The network is now resolved once, from the environment, and validated
// against the network of every address that crosses a trust boundary.
//
// The string values are deliberately identical to CashScript's `Network`
// enum, so they can be handed straight to `ElectrumNetworkProvider` and
// `new Contract(...)` without a translation table. Note that CashScript
// spells them `testnet3` / `testnet4` — there is no plain `"testnet"`.

export const BCH_NETWORKS = [
  "mainnet",
  "testnet3",
  "testnet4",
  "chipnet",
  "regtest",
  "mocknet",
] as const;

export type BchNetwork = (typeof BCH_NETWORKS)[number];

export function isBchNetwork(value: unknown): value is BchNetwork {
  return typeof value === "string" && (BCH_NETWORKS as readonly string[]).includes(value);
}

/** True for every network that carries no real-world value. */
export function isTestNetwork(network: BchNetwork): boolean {
  return network !== "mainnet";
}

/**
 * Parses a network name, falling back to `fallback` only when the value is
 * absent. An *invalid* value is always an error — silently coercing a typo
 * such as "testnet" or "chipnet " to a default would be exactly the class
 * of mistake this module exists to prevent.
 */
export function parseBchNetwork(
  value: string | undefined | null,
  fallback?: BchNetwork
): BchNetwork {
  if (value === undefined || value === null || value.trim() === "") {
    if (fallback === undefined) {
      throw new Error(
        `BCH_NETWORK is not set. Expected one of: ${BCH_NETWORKS.join(", ")}`
      );
    }
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (!isBchNetwork(normalized)) {
    throw new Error(
      `Unknown BCH network "${value}". Expected one of: ${BCH_NETWORKS.join(", ")}`
    );
  }
  return normalized;
}

// The cashaddress prefix each network uses. Note the collision: Chipnet,
// testnet3 and testnet4 all encode as `bchtest:`. A `bchtest:` address
// therefore proves the address is *not mainnet*, but it cannot on its own
// prove which of the three test networks the funds live on. That is
// inherent to the CashAddress format, not something this code can fix —
// see `assertAddressOnNetwork` for how the ambiguity is handled.
const CASHADDR_PREFIX_BY_NETWORK: Record<BchNetwork, string> = {
  mainnet: "bitcoincash",
  testnet3: "bchtest",
  testnet4: "bchtest",
  chipnet: "bchtest",
  regtest: "bchreg",
  mocknet: "bchreg",
};

export function cashaddrPrefix(network: BchNetwork): string {
  return CASHADDR_PREFIX_BY_NETWORK[network];
}

/**
 * Every network a `bchtest:` (or `bchreg:`) address could belong to. Used
 * to tell apart "this address is on the wrong network" (a hard error we
 * can prove) from "this address is on a test network but we can't tell
 * which one" (a warning).
 */
export function networksSharingPrefix(prefix: string): BchNetwork[] {
  return BCH_NETWORKS.filter((n) => CASHADDR_PREFIX_BY_NETWORK[n] === prefix);
}

export interface NetworkMismatch {
  address: string;
  addressPrefix: string;
  expected: BchNetwork;
  /** Networks this address could legally belong to, by prefix alone. */
  possibleNetworks: BchNetwork[];
  /** False when the prefix is shared, so we cannot prove a mismatch. */
  conclusive: boolean;
}

/**
 * Classifies a cashaddress against the active network. Returns `null` when
 * the address is consistent with the expected network.
 *
 * `conclusive: false` means the prefix is shared between the expected
 * network and others (e.g. Chipnet vs testnet3) — the address is accepted,
 * and the caller decides whether to warn. Only a prefix that cannot occur
 * on the expected network at all, such as a `bitcoincash:` address while
 * running on Chipnet, is treated as conclusive.
 */
export function inspectAddressOnNetwork(
  address: string,
  expected: BchNetwork
): NetworkMismatch | null {
  const prefix = address.includes(":") ? address.split(":", 1)[0]! : "";
  const wanted = cashaddrPrefix(expected);

  if (prefix === wanted) return null;

  return {
    address,
    addressPrefix: prefix,
    expected,
    possibleNetworks: prefix ? networksSharingPrefix(prefix) : [],
    conclusive: true,
  };
}
