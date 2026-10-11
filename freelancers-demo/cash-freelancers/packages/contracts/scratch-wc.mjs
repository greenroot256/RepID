import { ElectrumNetworkProvider } from "cashscript";
import { buildFundingWcTransaction, fetchSpendableUtxos } from "./src/escrow-funding.js";
import { stringify } from "@bitauth/libauth";

const address = process.env.WALLET_ADDRESS;
const network = "chipnet";

const utxos = await fetchSpendableUtxos(address, network);
console.log("utxos:", utxos.map((u) => ({ txid: u.txid, vout: u.vout, satoshis: String(u.satoshis) })));

const built = await buildFundingWcTransaction({
  clientAddress: address,
  contractAddress: "bchtest:qqqcw6cgn6v0d5j0j4hxt8gy0dvvqmvzqrsg6cvzqhq0h0k2yq0k2yq",
  amountSats: 31000,
  utxos,
  network
});
const wc = built.wcTransactionObject;

console.log("\n--- top-level keys:", Object.keys(wc));
console.log("--- sourceOutputs[0] keys:", Object.keys(wc.sourceOutputs[0]));
for (const k of Object.keys(wc.sourceOutputs[0])) {
  const v = wc.sourceOutputs[0][k];
  console.log(`    ${k}: ${v?.constructor?.name} = ${String(v).slice(0, 40)}`);
}
console.log("--- transaction is", wc.transaction?.constructor?.name);

try { JSON.stringify(wc); console.log("\nplain JSON.stringify: OK"); }
catch (e) { console.log("\nplain JSON.stringify THREW:", e.message); }
console.log("libauth stringify:", stringify(wc).slice(0, 300));
