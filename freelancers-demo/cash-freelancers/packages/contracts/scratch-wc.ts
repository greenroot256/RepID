import { readFileSync } from "node:fs";
import { stringify } from "@bitauth/libauth";
import { buildFundingWcTransaction, fetchSpendableUtxos } from "./src/escrow-funding.js";

// Read only the public addresses; private keys are never read or printed.
const file = JSON.parse(readFileSync("../../data/test-wallets.json", "utf8")) as {
  wallets: { role: string; address: string }[];
};
const address = file.wallets.find((w) => w.role === "client")!.address;
const contractAddress = file.wallets.find((w) => w.role === "arbiter")!.address;
console.log("client address prefix:", address.slice(0, 12));

const network = "chipnet" as const;
const utxos = await fetchSpendableUtxos(address, network);
console.log("utxos:", utxos.map((u) => ({ txid: u.txid, vout: u.vout, satoshis: String(u.satoshis) })));

const built = await buildFundingWcTransaction({
  clientAddress: address,
  contractAddress,
  amountSats: 31000,
  utxos,
  network
});
const wc = built.wcTransactionObject as Record<string, unknown>;
const so = wc.sourceOutputs as Record<string, unknown>[];

console.log("\ntop-level keys:", Object.keys(wc));
for (const k of Object.keys(so[0]!)) {
  const v = so[0]![k];
  console.log(`  sourceOutputs[0].${k}: ${(v as object)?.constructor?.name} = ${String(v).slice(0, 50)}`);
}
console.log("transaction:", (wc.transaction as object)?.constructor?.name);

try { JSON.stringify(wc); console.log("\nplain JSON.stringify: OK"); }
catch (e) { console.log("\nplain JSON.stringify THREW:", (e as Error).message); }
console.log("\nlibauth stringify:\n" + stringify(wc).slice(0, 600));
