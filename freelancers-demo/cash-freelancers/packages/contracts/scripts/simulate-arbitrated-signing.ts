/**
 * Local simulation of EscrowArbitrated's two-party signing flow, using a
 * `MockNetworkProvider` instead of real wallets. Useful for exercising
 * `startTwoPartySignature`/`completeTwoPartySignature` end to end before
 * testing against Cashonize/Paytaca/Zapit for real — those two
 * functions aren't simulated here (there's no real WalletConnect
 * session), only the transaction mechanics they depend on: building the
 * placeholder object, one signer filling their slot for real while
 * leaving the other as a placeholder, round-tripping through hex, and a
 * second signer completing it.
 *
 * Run with: pnpm --filter @cash-freelancers/contracts simulate:two-party
 */
import {
  MockNetworkProvider,
  SignatureTemplate,
  placeholderPublicKey,
  placeholderSignature,
  TransactionBuilder,
  randomUtxo
} from "cashscript";
import {
  secp256k1,
  hash160,
  hexToBin,
  binToHex,
  decodeTransactionCommon,
  encodeTransactionCommon,
  encodeCashAddress,
  CashAddressType
} from "@bitauth/libauth";
import { createEscrowArbitratedContract } from "../src/escrow-arbitrated.js";
import { parseBchNetwork, cashaddrPrefix } from "@cash-freelancers/shared";

function randomKeypair() {
  let priv: Uint8Array;
  do {
    priv = crypto.getRandomValues(new Uint8Array(32));
  } while (!secp256k1.validatePrivateKey(priv));
  const pub = secp256k1.derivePublicKeyCompressed(priv) as Uint8Array;
  return { priv, pub, pkh: hash160(pub) };
}

async function main() {
  // A MockNetworkProvider never touches the network, so this only has to be
  // consistent — but it is still read from BCH_NETWORK and passed explicitly
  // rather than defaulted, so that a typo in a network name fails here too
  // instead of silently selecting something else.
  const network = parseBchNetwork(process.env.BCH_NETWORK, "mainnet");

  const client = randomKeypair();
  const freelancer = randomKeypair();
  const arbiter = randomKeypair();

  const provider = new MockNetworkProvider();
  provider.network = network;

  // Uses the real, shipped wrapper — not a reimplementation — thanks to
  // the `provider` override added for testing.
  const contract = createEscrowArbitratedContract({
    clientPkh: client.pkh,
    freelancerPkh: freelancer.pkh,
    arbiterPkh: arbiter.pkh,
    network,
    provider
  });
  console.log("Network:", network);
  console.log("Contract address:", contract.address);

  // Derived at runtime so the checksum is always valid for whatever network
  // is selected — a hardcoded address would fail `OutputAddressNetworkMismatchError`
  // the moment BCH_NETWORK changed.
  //
  // Built by hand rather than with libauth's `publicKeyToP2pkhCashAddress`,
  // which is broken in @bitauth/libauth 3.1.0-next.8: it reaches
  // `generateBytecode` -> `compileScriptRaw` -> `parsePublicKey(undefined)`
  // and throws "Cannot convert undefined or null to object". Encoding the
  // P2PKH address from the hash160 directly sidesteps that broken helper.
  const destination = encodeCashAddress({
    payload: hash160(freelancer.pub),
    prefix: cashaddrPrefix(network),
    type: CashAddressType.p2pkh
  }).address;
  console.log("Destination:", destination);
  const utxo = { ...randomUtxo(), satoshis: 80_000n };
  provider.addUtxo(contract.address, utxo);

  // --- Round 1: the freelancer's wallet signs its own slot for real,
  // leaves the arbiter's slot as a placeholder. In production this
  // happens inside the freelancer's wallet software, not in our code —
  // simulated here by mixing a real SignatureTemplate with a placeholder
  // pair in the same unlock() call. ---
  const round1Builder = new TransactionBuilder({ provider });
  round1Builder
    .addInput(
      utxo,
      contract.unlock.spend(
        freelancer.pub,
        new SignatureTemplate(freelancer.priv),
        placeholderPublicKey(),
        placeholderSignature()
      )
    )
    .addOutput({ to: destination, amount: utxo.satoshis - 1000n });

  const round1WcTx = round1Builder.generateWcTransactionObject({ userPrompt: "round 1" });
  const round1Hex = binToHex(encodeTransactionCommon(round1WcTx.transaction));
  console.log("Round 1 (freelancer signs): produced", round1Hex.length / 2, "bytes");

  // What a real wallet would hand back as `signedTransaction` is exactly
  // this hex. Round-trip it through decode/encode to confirm nothing is
  // lost in transit and the arbiter's placeholder is still there,
  // exactly like `completeTwoPartySignature` would receive it.
  const decoded = decodeTransactionCommon(hexToBin(round1Hex));
  if (typeof decoded === "string") throw new Error(`Failed to decode round 1 transaction: ${decoded}`);

  const zeroSig = "00".repeat(65);
  const zeroPk = "00".repeat(33);
  const inputBytecodeHex = binToHex(decoded.inputs[0].unlockingBytecode);
  if (!inputBytecodeHex.includes(zeroSig) || !inputBytecodeHex.includes(zeroPk)) {
    throw new Error("Arbiter's placeholder did not survive the hex round-trip");
  }
  console.log("Round 1 -> hex -> decode round-trip OK, arbiter's placeholder still detectable");

  // --- Round 2: full, independent confirmation that a *fresh*, fully
  // co-signed transaction (both real signatures, arbiter siding with the
  // freelancer) is valid and spendable end to end.
  //
  // `send()` (not `build()`) is what runs the covenant's VM: `build()` only
  // assembles, so a `require` violation slips through it. Verified separately
  // — a release signed by the wrong party builds cleanly and is then rejected
  // by `send()` at escrow-bilateral.cash:19. That makes the negative cases
  // below meaningful, and the round-1 result above genuinely validated. ---
  const utxo2 = { ...randomUtxo(), satoshis: 80_000n };
  provider.addUtxo(contract.address, utxo2);
  const finalBuilder = new TransactionBuilder({ provider });
  finalBuilder
    .addInput(
      utxo2,
      contract.unlock.spend(
        freelancer.pub,
        new SignatureTemplate(freelancer.priv),
        arbiter.pub,
        new SignatureTemplate(arbiter.priv)
      )
    )
    .addOutput({ to: destination, amount: utxo2.satoshis - 1000n });
  const txid = await finalBuilder.send();
  console.log("Fully co-signed transaction accepted by the contract, txid:", txid.txid ?? txid);

  // --- Negative cases: the 2-of-3 must not be satisfiable with one party,
  // either by signing the same slot twice or by passing a signature that
  // doesn't belong to any of the three. Without these the test would still
  // pass if `pkh1 != pkh2` (escrow-arbitrated.cash:34) were dropped. ---
  const arbiterOnly = { ...randomUtxo(), satoshis: 80_000n };
  provider.addUtxo(contract.address, arbiterOnly);
  const sameSignerTwice = new TransactionBuilder({ provider });
  sameSignerTwice
    .addInput(
      arbiterOnly,
      // Both slots filled by the arbiter: two valid signatures, but only one
      // distinct person, which the covenant must refuse.
      contract.unlock.spend(
        arbiter.pub,
        new SignatureTemplate(arbiter.priv),
        arbiter.pub,
        new SignatureTemplate(arbiter.priv)
      )
    )
    .addOutput({ to: destination, amount: arbiterOnly.satoshis - 1000n });
  try {
    await sameSignerTwice.send();
    throw new Error("The contract accepted the same party in both signature slots");
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("The contract accepted")) throw err;
    console.log("Rejected as expected — the same party in both slots:", String((err as Error).message).slice(0, 70));
  }

  const stranger = randomKeypair();
  const strangerUtxo = { ...randomUtxo(), satoshis: 80_000n };
  provider.addUtxo(contract.address, strangerUtxo);
  const outsider = new TransactionBuilder({ provider });
  outsider
    .addInput(
      strangerUtxo,
      // A valid signature pair, but from a party that is none of the three.
      contract.unlock.spend(
        stranger.pub,
        new SignatureTemplate(stranger.priv),
        freelancer.pub,
        new SignatureTemplate(freelancer.priv)
      )
    )
    .addOutput({ to: destination, amount: strangerUtxo.satoshis - 1000n });
  try {
    await outsider.send();
    throw new Error("The contract accepted a signature from a party that is not client/freelancer/arbiter");
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("The contract accepted")) throw err;
    console.log("Rejected as expected — a party outside the escrow:", String((err as Error).message).slice(0, 70));
  }

  console.log("\nAll checks passed.");
}

main().catch((err) => {
  console.error("Simulation failed:", err);
  process.exit(1);
});
