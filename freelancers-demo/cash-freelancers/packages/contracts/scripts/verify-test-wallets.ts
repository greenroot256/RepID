/**
 * Verifies data/test-wallets.json: every WIF must decode to the private key
 * that hashes to the pkh in the address it is paired with. Run this before
 * funding anything — a mismatch would send test coins to an address whose
 * keys nobody holds.
 *
 * Run with: pnpm --filter @cash-freelancers/contracts verify:wallets
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  decodePrivateKeyWif,
  decodeCashAddress,
  encodePrivateKeyWif,
  secp256k1,
  hash160,
  binToHex
} from "@bitauth/libauth";
import { parseBchNetwork, cashaddrPrefix } from "@cash-freelancers/shared";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");
const walletsPath = join(repoRoot, "data", "test-wallets.json");

interface WalletRecord {
  role: string;
  address: string;
  wif: string;
  privateKeyHex: string;
  publicKeyHex: string;
  pkhHex: string;
}

function main() {
  const network = parseBchNetwork(process.env.BCH_NETWORK, "chipnet");

  if (!existsSync(walletsPath)) {
    console.error(`No wallet file at ${walletsPath}. Run generate:wallets first.`);
    process.exit(1);
  }

  const store = JSON.parse(readFileSync(walletsPath, "utf8")) as {
    network: string;
    wallets: WalletRecord[];
  };

  let failures = 0;
  const fail = (msg: string) => {
    failures++;
    console.log(`  FAIL ${msg}`);
  };

  if (store.network !== network) {
    fail(`file was generated for ${store.network} but BCH_NETWORK is ${network}`);
  }

  const expectedPrefix = cashaddrPrefix(network);

  for (const w of store.wallets) {
    console.log(`${w.role}:`);

    // 1. WIF decodes and is encoded for the right network.
    let decoded: { privateKey: Uint8Array; type: string };
    try {
      decoded = decodePrivateKeyWif(w.wif);
    } catch (e) {
      fail(`WIF does not decode: ${(e as Error).message}`);
      continue;
    }
    const expectedWifNetwork = network === "mainnet" ? "mainnet" : "testnet";
    if (decoded.type !== expectedWifNetwork) {
      fail(`WIF is ${decoded.type}, expected ${expectedWifNetwork}`);
    }

    // 2. The private key matches the hex we stored.
    if (binToHex(decoded.privateKey) !== w.privateKeyHex) {
      fail("WIF does not decode to the stored private key");
    }

    // 3. The private key derives the stored public key and pkh.
    const pub = secp256k1.derivePublicKeyCompressed(decoded.privateKey);
    if (binToHex(pub) !== w.publicKeyHex) {
      fail("derived public key does not match the stored one");
    }
    if (binToHex(hash160(pub)) !== w.pkhHex) {
      fail("derived pkh does not match the stored one");
    }

    // 4. The address decodes, is on the right network, and carries that pkh.
    const addr = decodeCashAddress(w.address);
    if (typeof addr === "string") {
      fail(`address does not decode: ${addr}`);
    } else {
      if (addr.prefix !== expectedPrefix) {
        fail(`address prefix is ${addr.prefix}:, expected ${expectedPrefix}:`);
      }
      if (addr.type !== "p2pkh") {
        fail(`address type is ${addr.type}, expected p2pkh`);
      }
      if (binToHex(addr.payload) !== w.pkhHex) {
        fail("address payload does not match the stored pkh");
      }
    }

    // 5. Re-encoding the WIF is stable (catches a corrupted field).
    if (encodePrivateKeyWif(decoded.privateKey, expectedWifNetwork as "mainnet" | "testnet" | "regtest") !== w.wif) {
      fail("WIF is not stable under re-encoding");
    }

    if (failures === 0) console.log(`  OK   ${w.address}`);
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed. Do not fund these wallets.`);
    process.exit(1);
  }
  console.log(`\nAll ${store.wallets.length} wallets verified on ${network}.`);
}

main();
