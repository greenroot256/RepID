/**
 * Reports the confirmed and unconfirmed balance of every wallet in
 * data/test-wallets.json, straight from the Electrum server for the active
 * network. Used to confirm funding actually landed before any test starts.
 *
 * Run with: pnpm --filter @cash-freelancers/contracts wallets:balances
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ElectrumNetworkProvider } from "cashscript";
import { parseBchNetwork } from "@cash-freelancers/shared";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");
const walletsPath = join(repoRoot, "data", "test-wallets.json");

/**
 * Standard P2PKH locking bytecode: OP_DUP OP_HASH160 <20-byte pkh> OP_EQUALVERIFY
 * OP_CHECKSIG. cashscript 0.13.x does not export the LockingBytecode classes, so
 * the scriptPubKey is assembled directly.
 */
function p2pkhLockingBytecode(pkhHex: string): string {
  if (!/^[0-9a-fA-F]{40}$/.test(pkhHex)) {
    throw new Error(`Not a 20-byte hash160: ${pkhHex}`);
  }
  return `76a914${pkhHex.toLowerCase()}88ac`;
}

/**
 * Electrum indexes by script hash, not address: sha256 of the scriptPubKey,
 * byte-reversed and hex-encoded. Derived here because the address alone is not
 * enough to call blockchain.scripthash.* directly.
 */
function electrumScripthash(scriptHex: string): string {
  return createHash("sha256").update(Buffer.from(scriptHex, "hex")).digest().reverse().toString("hex");
}

interface ElectrumUnspent {
  tx_hash: string;
  tx_pos: number;
  value: number;
  /** 0 while the transaction is still in the mempool, block height once mined. */
  height: number;
}

interface WalletRecord {
  role: string;
  address: string;
  pkhHex: string;
}

async function main() {
  const network = parseBchNetwork(process.env.BCH_NETWORK, "chipnet");

  if (!existsSync(walletsPath)) {
    console.error(`No wallet file at ${walletsPath}. Run generate:wallets first.`);
    process.exit(1);
  }

  const store = JSON.parse(readFileSync(walletsPath, "utf8")) as {
    network: string;
    wallets: WalletRecord[];
  };

  const provider = new ElectrumNetworkProvider(network);
  const height = await provider.getBlockHeight();
  console.log(`Network: ${network}  (Electrum height ${height})\n`);

  let totalConfirmed = 0n;
  let funded = 0;
  let unconfirmedWallets = 0;

  for (const w of store.wallets) {
    // Confirmation state has to come from the Electrum server. cashscript's own
    // Utxo shape is { txid, vout, satoshis } with no height field, so a UTXO set
    // from getUtxosForLockingBytecode cannot say whether a coin is mined and
    // every balance would read as unconfirmed. listunspent reports the real
    // height: 0 in the mempool, the block height once mined.
    const scripthash = electrumScripthash(p2pkhLockingBytecode(w.pkhHex));
    const response = await provider.performRequest("blockchain.scripthash.listunspent", scripthash);
    // performRequest resolves with the bare result value for listunspent, but
    // tolerate a wrapped { result } too rather than silently reading zero coins.
    const utxos = (Array.isArray(response) ? response : (response as { result?: ElectrumUnspent[] })?.result ?? []) as ElectrumUnspent[];
    if (utxos.length === 0) {
      throw new Error(
        `Electrum returned no UTXOs for ${w.role} (${w.address}) and no response payload to inspect. ` +
          `Treating a missing response as an empty wallet would hide a broken query.`
      );
    }

    let confirmed = 0n;
    let unconfirmed = 0n;
    for (const u of utxos) {
      if (u.height > 0 && u.height <= height) confirmed += BigInt(u.value);
      else unconfirmed += BigInt(u.value);
    }

    totalConfirmed += confirmed;
    if (confirmed > 0n || unconfirmed > 0n) funded++;
    if (confirmed === 0n && unconfirmed > 0n) unconfirmedWallets++;
    console.log(
      `  ${w.role.toUpperCase().padEnd(10)} ${w.address}\n` +
        `             confirmed ${String(confirmed).padStart(10)} sats   unconfirmed ${String(unconfirmed).padStart(10)} sats   utxos ${utxos.length}`
    );
    // The outpoint is what makes a stuck faucet payment diagnosable: it can be
    // looked up on the explorer to see whether it was ever mined, and its vout
    // decides whether it can fund a CashTokens genesis (which requires vout 0).
    for (const u of utxos) {
      const state =
        u.height > 0 && u.height <= height
          ? `confirmed at height ${u.height} (${height - u.height + 1} confirmations)`
          : `UNCONFIRMED (height ${String(u.height)})`;
      console.log(
        `               ${u.tx_hash}:${u.tx_pos}  ${u.value} sats  ${state}` +
          (u.tx_pos === 0 ? "" : "  [WARNING: vout != 0, cannot fund a CashTokens genesis]")
      );
    }
  }

  console.log(`\n  funded wallets: ${funded}/${store.wallets.length}   total confirmed: ${totalConfirmed} sats`);
  if (unconfirmedWallets > 0) {
    console.log(
      `\n  ${unconfirmedWallets} wallet(s) hold only UNCONFIRMED coins. The funding transaction is still\n` +
        `  in the mempool. Wait for it to be mined before any test that broadcasts, or re-request\n` +
        `  funds from https://tbch.googol.cash. Check the outpoints above on\n` +
        `  https://chipnet.chaingraph.cash to see whether they were ever mined.`
    );
  }
  if (funded < store.wallets.length) {
    console.log("\n  Fund the remaining addresses at https://tbch.googol.cash (~0.001 tBCH each).");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
