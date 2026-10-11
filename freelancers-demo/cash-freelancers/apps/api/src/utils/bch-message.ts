import {
  secp256k1,
  sha256,
  hash160,
  utf8ToBin,
  binToBase64,
  base64ToBin,
  decodeCashAddress,
  bigIntToCompactUint,
  type RecoveryId
} from "@bitauth/libauth";

// The standard "Bitcoin Signed Message" convention: a magic-prefixed,
// varint-length-prefixed, double-sha256 hash of the message. The same
// scheme Electron Cash and most BCH wallets use for message signing —
// see https://github.com/Electron-Cash/Electron-Cash/blob/master/electroncash/bitcoin.py
// (search "Bitcoin Signed Message"). This is what a wallet's
// `bch_signMessage` (see @cash-freelancers/wallet-connect) is expected
// to produce.
function magicHash(message: string): Uint8Array {
  const prefix = utf8ToBin("\x18Bitcoin Signed Message:\n");
  const messageBin = utf8ToBin(message);
  const length = bigIntToCompactUint(BigInt(messageBin.length));
  const payload = new Uint8Array([...prefix, ...length, ...messageBin]);
  return sha256.hash(sha256.hash(payload));
}

/**
 * Verifies a base64 compact signature (the standard 65-byte
 * header-byte + r + s format) against a message and a P2PKH cashaddress.
 * Used by /auth/verify to confirm whoever holds the wallet for
 * `address` actually signed `message` — this is the whole of "login"
 * for a wallet-native identity system: no passwords, the wallet IS the
 * identity.
 */
export function verifyMessage(message: string, signatureBase64: string, address: string): boolean {
  let sig: Uint8Array;
  try {
    sig = base64ToBin(signatureBase64);
  } catch {
    return false;
  }
  if (sig.length !== 65) return false;

  const header = sig[0];
  const recoveryId = ((header - 27) % 4) as RecoveryId;
  const compressed = header >= 31;
  const compact = sig.slice(1);
  const hash = magicHash(message);

  const pk = compressed
    ? secp256k1.recoverPublicKeyCompressed(compact, recoveryId, hash)
    : secp256k1.recoverPublicKeyUncompressed(compact, recoveryId, hash);
  if (typeof pk === "string") return false;

  const validSignature = secp256k1.verifySignatureCompact(compact, pk, hash);
  if (!validSignature) return false;

  const decoded = decodeCashAddress(address);
  if (typeof decoded === "string" || decoded.type !== "p2pkh") return false;

  const pkh = hash160(pk);
  return pkh.length === decoded.payload.length && pkh.every((b, i) => b === decoded.payload[i]);
}

/**
 * Dev/test-only helper: signs a message the way a wallet would, given a
 * raw private key. Nothing in the running app ever holds a user's
 * private key — this exists purely so the two-step-signing-style
 * end-to-end tests in this project can simulate a wallet without a real
 * one. Never call this from a route.
 */
export function signMessageForTesting(message: string, privateKey: Uint8Array): string {
  const hash = magicHash(message);
  const rs = secp256k1.signMessageHashRecoverableCompact(privateKey, hash);
  if (typeof rs === "string") throw new Error(rs);
  const header = 31 + rs.recoveryId; // compressed-pubkey convention
  return binToBase64(new Uint8Array([header, ...rs.signature]));
}
