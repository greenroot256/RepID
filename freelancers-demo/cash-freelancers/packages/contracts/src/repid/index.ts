import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { compileFile } from "cashc";
import {
  Contract,
  ElectrumNetworkProvider,
  TransactionBuilder,
  SignatureTemplate,
  placeholderPublicKey,
  placeholderSignature,
  type NetworkProvider,
  type Output,
  type Utxo
} from "cashscript";
import { secp256k1, hash160, hexToBin, binToHex } from "@bitauth/libauth";
import type { BchNetwork } from "@cash-freelancers/shared";
import { dustAmount, p2pkhDust, P2SH32_SCRIPT_LEN } from "../dust.js";

/**
 * CashScript wrappers for the three RepID contracts.
 *
 * The `.cash` sources are vendored verbatim from the RepID reference
 * implementation (`RepID 1.2/contracts/`) and are authoritative — the
 * covenants themselves are not reimplemented here, only wrapped.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const identityGenesisArtifact = compileFile(join(__dirname, "identity_genesis.cash"));
const identityVaultArtifact = compileFile(join(__dirname, "identity_vault.cash"));
const receiptGenesisArtifact = compileFile(join(__dirname, "receipt_genesis.cash"));

const GENESIS_FEE = 1000n;

// --- The byte-order trap ---------------------------------------------------
//
// This is the most dangerous detail in the whole RepID integration, so it gets
// a named helper and its own test instead of being inlined at call sites.
//
// A CashToken's `category` is the *internal*-order txid of the transaction
// that created it, but every UTXO source we work with — Electrum, and therefore
// `Utxo.txid` — reports that txid in *display* order (byte-reversed). The
// covenant compares against `outpointTransactionHash`, which is internal order.
// Handing an Electrum txid straight to `addOutput({ token })` mints into a
// category that does not exist, and the VM rejects the spend.
//
// Verified against real Chipnet data (RepID 1.2 / data_chipnet_e2e): the
// identity genesis spends outpoint `e34421c8…3675`, while the resulting
// identity's on-chain category is `7536a72f…4e3` — the exact byte-reverse.
//
// The reference implementation gets away with `category = txid` only because it
// builds the funding transaction itself, and `builder.send()` (unlike Electrum)
// reports the txid in internal order. Reading a txid from a provider and using
// it verbatim is the bug this function exists to prevent.
export function toCategoryId(displayOrderTxid: string): string {
  const hex = displayOrderTxid.toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    throw new Error(`"${displayOrderTxid}" is not a 32-byte hex txid`);
  }
  return binToHex(new Uint8Array(hexToBin(hex)).reverse());
}

/**
 * Every RepID genesis covenant requires the funding UTXO to come from vout 0 of
 * its source transaction (the CashTokens genesis rule). A UTXO at vout 1+ can
 * never mint a new category: the transaction would build, broadcast, and then be
 * rejected — wasting the fee. Caught up front instead.
 */
export function assertGenesisCapableUtxo(utxo: Utxo, contractAddress: string): void {
  if (utxo.vout !== 0) {
    throw new Error(
      `${utxo.txid}:${utxo.vout} is at vout ${utxo.vout}, but minting a new CashToken category ` +
        `requires the funding UTXO to be at vout 0 of its source transaction. ` +
        `Pick a different UTXO to fund ${contractAddress}.`
    );
  }
  if (utxo.token) {
    throw new Error(
      `${utxo.txid}:${utxo.vout} already carries a token; the genesis funding UTXO must be plain BCH.`
    );
  }
}

/** Asserts the locked amounts plus the fee still leave a non-dust change output. */
function assertChangeIsPossible(lockedSats: bigint, availableSats: bigint): void {
  const change = availableSats - lockedSats - GENESIS_FEE;
  if (change < p2pkhDust()) {
    throw new Error(
      `Locking ${lockedSats} sats + a ${GENESIS_FEE} sat fee out of a ${availableSats} sat UTXO ` +
        `leaves ${change} sats of change, below the minimum relayable amount. ` +
        `Consolidate the wallet's UTXOs into one larger UTXO and fund from that.`
    );
  }
}

export interface RepidContractParams {
  network: BchNetwork;
  provider?: NetworkProvider;
}

function pkhOf(privateKey: Uint8Array): { publicKey: Uint8Array; pkh: Uint8Array } {
  // libauth types these as `Uint8Array | string` (string is a base64 fallback),
  // so narrow explicitly rather than casting.
  const publicKey = secp256k1.derivePublicKeyCompressed(privateKey);
  if (typeof publicKey === "string") {
    throw new Error("derivePublicKeyCompressed unexpectedly returned a base64 public key");
  }
  return { publicKey, pkh: hash160(publicKey) };
}

// --- IdentityGenesisValidator ----------------------------------------------

export type IdentityGenesisContract = ReturnType<typeof createIdentityGenesisContract>;

export function createIdentityGenesisContract({
  ownerPkh,
  network,
  provider = new ElectrumNetworkProvider(network)
}: RepidContractParams & { ownerPkh: Uint8Array }) {
  return new Contract(identityGenesisArtifact, [ownerPkh], { provider });
}

/**
 * Genesis of a RepID Identity.
 *
 * `mint()` takes no arguments and requires no signature: the covenant only
 * constrains the outputs. Authorization comes from the funder's own P2PKH
 * signature on the funding transaction, and the change output is locked back to
 * the owner.
 *
 * Returns `category` — the internal-order txid of the *funding* transaction,
 * which is the identity's on-chain category and NOT the genesis txid.
 */
export async function mintIdentity(input: {
  contract: IdentityGenesisContract;
  ownerAddress: string;
  fundingUtxo: Utxo;
}): Promise<{ txid: string; category: string }> {
  const { contract, ownerAddress, fundingUtxo } = input;
  assertGenesisCapableUtxo(fundingUtxo, contract.address);

  const category = toCategoryId(fundingUtxo.txid);
  const nftAmount = p2pkhDust("");
  const nftOutput: Output = {
    to: ownerAddress,
    // The covenant does not constrain output 0's value, so the minimum is used
    // and everything else becomes change back to the owner.
    amount: nftAmount,
    token: { category, amount: 0n, nft: { capability: "none", commitment: "" } }
  };
  assertChangeIsPossible(nftAmount, fundingUtxo.satoshis);

  const builder = new TransactionBuilder({ provider: contract.provider });
  builder
    .addInput(fundingUtxo, contract.unlock.mint())
    .addOutput(nftOutput)
    .addOutput({ to: ownerAddress, amount: fundingUtxo.satoshis - nftAmount - GENESIS_FEE });

  const tx = await builder.send();
  return { txid: tx.txid, category };
}

// --- IdentityVault ---------------------------------------------------------

export type IdentityVaultContract = ReturnType<typeof createIdentityVaultContract>;

export function createIdentityVaultContract({
  ownerPkh,
  network,
  provider = new ElectrumNetworkProvider(network)
}: RepidContractParams & { ownerPkh: Uint8Array }) {
  return new Contract(identityVaultArtifact, [ownerPkh], { provider });
}

/**
 * Genesis of the identity NFT *inside the collateral vault*.
 *
 * Unlike IdentityGenesisValidator this one requires the owner's signature
 * (`mint(pubkey, sig, int)`), and it re-locks the NFT to the covenant itself so
 * the collateral cannot leave without an authorized owner decision. The
 * `nftCommitment` stores the owner's pkh precisely because a P2SH output is
 * otherwise opaque to an indexer.
 *
 * Passing a `SignatureTemplate` where a `sig` is expected is CashScript's
 * supported local-signing path: it computes the sighash and signature lazily
 * when the unlocking bytecode is generated. It is not a `sig` value.
 */
export async function mintVaultedIdentity(input: {
  contract: IdentityVaultContract;
  ownerAddress: string;
  ownerPrivateKey: Uint8Array;
  fundingUtxo: Utxo;
  collateral: bigint;
}): Promise<{ txid: string; category: string }> {
  const { contract, ownerAddress, ownerPrivateKey, fundingUtxo, collateral } = input;
  assertGenesisCapableUtxo(fundingUtxo, contract.address);
  if (collateral <= 0n) {
    throw new Error(`IdentityVault collateral must be strictly positive, got ${collateral}`);
  }
  // The vault output re-locks to the covenant (P2SH32) and carries the NFT, so
  // its dust floor is higher than a P2PKH one — check the change against that.
  const vaultDust = dustAmount(P2SH32_SCRIPT_LEN, "00".repeat(20));
  if (collateral < vaultDust) {
    throw new Error(
      `IdentityVault collateral of ${collateral} sats is below the ${vaultDust} sat minimum for an ` +
        `NFT output locked to the covenant.`
    );
  }
  assertChangeIsPossible(collateral, fundingUtxo.satoshis);

  const category = toCategoryId(fundingUtxo.txid);
  const { publicKey, pkh } = pkhOf(ownerPrivateKey);

  const builder = new TransactionBuilder({ provider: contract.provider });
  builder
    .addInput(
      fundingUtxo,
      contract.unlock.mint(publicKey, new SignatureTemplate(ownerPrivateKey), collateral)
    )
    // Locked to the covenant itself, not to the owner's P2PKH: the covenant
    // requires output 0's locking bytecode to equal the spent input's.
    .addOutput({
      to: contract.tokenAddress,
      amount: collateral,
      token: {
        category,
        amount: 0n,
        nft: { capability: "none", commitment: binToHex(pkh) }
      }
    })
    .addOutput({ to: ownerAddress, amount: fundingUtxo.satoshis - collateral - GENESIS_FEE });

  const tx = await builder.send();
  return { txid: tx.txid, category };
}

// --- ReceiptGenesisValidator ----------------------------------------------

export type ReceiptGenesisContract = ReturnType<typeof createReceiptGenesisContract>;

export function createReceiptGenesisContract({
  partyAPkh,
  partyBPkh,
  network,
  provider = new ElectrumNetworkProvider(network)
}: RepidContractParams & { partyAPkh: Uint8Array; partyBPkh: Uint8Array }) {
  return new Contract(receiptGenesisArtifact, [partyAPkh, partyBPkh], { provider });
}

export interface ReceiptGenesisParts {
  /** hash160(partyA pubkey) as hex — the Receipt and partyA's Rating Right. */
  partyAPkhHex: string;
  partyBPkhHex: string;
}

/**
 * Builds the Receipt Genesis transaction as a WalletConnect BCH object with BOTH
 * signature slots left as placeholders, for the two-step co-signing flow: the
 * first signer fills their own slot, then the second party completes and
 * broadcasts the partially-signed transaction.
 *
 * `partyA` is the party *funding* the genesis. The covenant sends the change
 * back to partyA and locks the Receipt to partyA's P2PKH by convention.
 *
 * Output layout is fixed by the covenant (`require(tx.outputs.length == 4)`):
 *   0 — Interaction Receipt NFT     -> partyA P2PKH, no commitment
 *   1 — partyA's Rating Right       -> partyA P2PKH, commitment = partyB pkh
 *   2 — partyB's Rating Right       -> partyB P2PKH, commitment = partyA pkh
 *   3 — change, pure cash           -> partyA P2PKH
 */
export async function buildReceiptGenesisWcTransaction(input: {
  contract: ReceiptGenesisContract;
  partyAAddress: string;
  partyBAddress: string;
  parts: ReceiptGenesisParts;
  fundingUtxo: Utxo;
}) {
  const { contract, partyAAddress, partyBAddress, parts, fundingUtxo } = input;
  assertGenesisCapableUtxo(fundingUtxo, contract.address);

  const category = toCategoryId(fundingUtxo.txid);
  const immutableNft = (to: string, commitment: string): Output => ({
    to,
    amount: p2pkhDust(commitment),
    token: { category, amount: 0n, nft: { capability: "none", commitment } }
  });

  const receipt = immutableNft(partyAAddress, "");
  const ratingRightA = immutableNft(partyAAddress, parts.partyBPkhHex);
  const ratingRightB = immutableNft(partyBAddress, parts.partyAPkhHex);

  // The change output must be the remainder *after* the three token outputs,
  // otherwise the outputs would claim more value than the input holds and the
  // transaction would be rejected as an over-spend.
  const locked = receipt.amount + ratingRightA.amount + ratingRightB.amount;
  assertChangeIsPossible(locked, fundingUtxo.satoshis);
  const change = fundingUtxo.satoshis - locked - GENESIS_FEE;

  const builder = new TransactionBuilder({ provider: contract.provider });
  builder
    .addInput(
      fundingUtxo,
      contract.unlock.mint(
        placeholderPublicKey(),
        placeholderSignature(),
        placeholderPublicKey(),
        placeholderSignature()
      )
    )
    .addOutput(receipt)
    .addOutput(ratingRightA)
    .addOutput(ratingRightB)
    .addOutput({ to: partyAAddress, amount: change });

  return builder.generateWcTransactionObject({
    userPrompt: "Co-sign the interaction receipt (both parties must sign)"
  });
}

export { identityGenesisArtifact, identityVaultArtifact, receiptGenesisArtifact };
