/**
 * Generates the three throwaway wallets the end-to-end test needs:
 * a client, a freelancer and an arbiter.
 *
 * The keys are written to `data/test-wallets.json`, which is git-ignored
 * (see .gitignore). Nothing here is ever printed in full except the
 * addresses, which are public and which you need in order to fund them.
 *
 * Addresses are encoded for the network in BCH_NETWORK. For Chipnet that is
 * a `bchtest:` address, and the WIFs are encoded as testnet — libauth
 * deliberately does not reject a mainnet WIF on decode, so the network is
 * pinned here at generation time instead of being discovered later.
 *
 * Run with: pnpm --filter @cash-freelancers/contracts generate:wallets
 */
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  encodeCashAddress,
  encodePrivateKeyWif,
  binToHex,
  secp256k1,
  hash160,
  CashAddressType
} from "@bitauth/libauth";
import { parseBchNetwork, cashaddrPrefix, isTestNetwork, type BchNetwork } from "@cash-freelancers/shared";

interface WalletRecord {
  role: "client" | "freelancer" | "arbiter";
  address: string;
  wif: string;
  privateKeyHex: string;
  publicKeyHex: string;
  pkhHex: string;
}

const ROLES = ["client", "freelancer", "arbiter"] as const;

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");
const walletsPath = join(repoRoot, "data", "test-wallets.json");

/** libauth's WIF network parameter. Chipnet uses testnet key encoding. */
function wifNetwork(network: BchNetwork): "mainnet" | "testnet" | "regtest" {
  return network === "mainnet" ? "mainnet" : "testnet";
}

/**
 * 32 random bytes that are a valid secp256k1 private key. The odds of a
 * random 32-byte value being invalid are negligible but not zero (it has to
 * be in [1, n-1]), and an invalid key would fail much later with a confusing
 * signature error, so it is checked here.
 */
function generatePrivateKey(): Uint8Array {
  for (;;) {
    const candidate = new Uint8Array(randomBytes(32));
    if (secp256k1.validatePrivateKey(candidate)) return candidate;
  }
}

function generateWallet(role: WalletRecord["role"], network: BchNetwork): WalletRecord {
  const privateKey = generatePrivateKey();
  const publicKey = secp256k1.derivePublicKeyCompressed(privateKey);
  const pkh = hash160(publicKey);

  return {
    role,
    address: encodeCashAddress({
      payload: pkh,
      prefix: cashaddrPrefix(network),
      type: CashAddressType.p2pkh
    }).address,
    wif: encodePrivateKeyWif(privateKey, wifNetwork(network)),
    privateKeyHex: binToHex(privateKey),
    publicKeyHex: binToHex(publicKey),
    pkhHex: binToHex(pkh)
  };
}

function main() {
  const network = parseBchNetwork(process.env.BCH_NETWORK, "chipnet");

  if (!isTestNetwork(network) && !process.argv.includes("--force")) {
    console.error(
      `Refusing to generate test wallets for ${network} without --force.\n` +
        `These are throwaway keys. Set BCH_NETWORK=chipnet unless you truly ` +
        `mean to fund mainnet.`
    );
    process.exit(1);
  }

  if (existsSync(walletsPath) && !process.argv.includes("--force")) {
    console.error(
      `${walletsPath} already exists.\n` +
        `Refusing to overwrite it — that would orphan any funds already sent ` +
        `to the existing addresses. Re-run with --force only if you accept ` +
        `losing the current keys (and any unspent balance).`
    );
    process.exit(1);
  }

  const wallets: WalletRecord[] = ROLES.map((role) => generateWallet(role, network));

  const store = {
    note:
      "Throwaway Chipnet test keys for the end-to-end run. Git-ignored. " +
      "Sweep any unspent balance with scripts/sweep-test-wallets.ts before " +
      "discarding this file.",
    network,
    cashaddrPrefix: cashaddrPrefix(network),
    createdAt: new Date().toISOString(),
    wallets
  };

  mkdirSync(dirname(walletsPath), { recursive: true });
  writeFileSync(walletsPath, JSON.stringify(store, null, 2) + "\n");

  console.log(`Network: ${network} (addresses use the ${cashaddrPrefix(network)}: prefix)`);
  console.log(`Keys written to: ${walletsPath}`);
  console.log(`This file is git-ignored. Do not commit it or share it.\n`);
  console.log("Fund each address with ~0.001 tBCH (100,000 sats) from:");
  console.log("  https://tbch.googol.cash\n");

  for (const w of wallets) {
    console.log(`  ${w.role.toUpperCase().padEnd(10)} ${w.address}`);
  }
  console.log("");
}

main();
