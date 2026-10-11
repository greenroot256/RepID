import { decodeCashAddress } from "@bitauth/libauth";
import { cashaddrPrefix, type BchNetwork } from "@cash-freelancers/shared";
import { network } from "../config.js";

/**
 * Decodes a cashaddress, checking the checksum and confirming the address
 * belongs to the network this service is configured for.
 *
 * This is the API boundary check. It is not the only defence: CashScript
 * independently throws `OutputAddressNetworkMismatchError` when a
 * transaction output points at another network, and rejects a bad
 * checksum. What this adds is a clear, early error at the point where an
 * address is accepted into the database — otherwise a mainnet address can
 * be stored on a Chipnet deployment and the mismatch only surfaces much
 * later, when someone tries to build a contract, as an unrelated-looking
 * CashScript failure.
 *
 * Note the residual ambiguity: Chipnet, testnet3 and testnet4 all share the
 * `bchtest:` prefix, so a matching prefix proves the address is not
 * mainnet but cannot prove which of the three it belongs to.
 */
export function decodeAddressForNetwork(address: string, expected: BchNetwork = network) {
  const decoded = decodeCashAddress(address);
  if (typeof decoded === "string") {
    throw new Error(`Invalid cashaddress "${address}": ${decoded}`);
  }

  const wanted = cashaddrPrefix(expected);
  if (decoded.prefix !== wanted) {
    throw new Error(
      `Address "${address}" is a ${decoded.prefix}: address, but this server is running on ` +
        `${expected} and expects ${wanted}: addresses. Refusing to store it — ` +
        `an address from another network can never sign for a contract on this one.`
    );
  }

  return decoded;
}

/**
 * Derives the public-key hash (pkh) from a P2PKH cashaddress. We store
 * `wallet_address` on `users` and derive the pkh on the fly wherever a
 * contract needs it (clientPkh/freelancerPkh/arbiterPkh), instead of
 * storing the pkh a second time — the address already encodes it.
 */
export function pkhFromAddress(address: string): Uint8Array {
  const decoded = decodeAddressForNetwork(address);
  if (decoded.type !== "p2pkh") {
    throw new Error(`Expected a P2PKH cashaddress, got type "${decoded.type}"`);
  }
  return decoded.payload;
}
