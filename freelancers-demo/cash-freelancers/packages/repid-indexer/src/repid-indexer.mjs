// RFC-006 — Indexer Specification
//
// The indexer rebuilds RepID "facts" from the raw hex of a transaction,
// using libauth's decodeTransactionBCH (CashTokens-aware). It does not
// re-validate covenant rules (the network already did that when mining
// the block): it only recognizes the transaction "shape" and extracts data.
//
// Design principle: the blockchain stores facts, interpretation stays
// off-chain. This module is limited to fact extraction; any value
// judgment about a rating (is it reliable? how is it weighted?) lives
// in a later layer, not here.
//
// Byte note: inside CashScript covenants, tokenCategory is handled in
// "internal" order (not reversed). decodeTransactionBCH, on the other
// hand, returns outpointTransactionHash and token.category already in
// "display order" (the same order seen by wallets and explorers) — nothing
// needs to be reversed here.

import { decodeTransactionBCH, binToHex, hashTransaction, hash160 } from '@bitauth/libauth';
import { readFileSync, writeFileSync } from 'node:fs';
import { REPID_RATING_TAG, REPID_PLATFORM_TAG, REPID_TRUST_TAG, MIN_SCORE, MAX_SCORE } from '@repid/protocol';

const P2PKH_PREFIX = new Uint8Array([0x76, 0xa9, 0x14]); // OP_DUP OP_HASH160 <push 20>
const P2PKH_SUFFIX = new Uint8Array([0x88, 0xac]); // OP_EQUALVERIFY OP_CHECKSIG
const OP_RETURN = 0x6a;

function bytesEqual(a, b, aOffset = 0) {
  if (a.length - aOffset < b.length) return false;
  for (let i = 0; i < b.length; i += 1) {
    if (a[aOffset + i] !== b[i]) return false;
  }
  return true;
}

// If `lockingBytecode` is a standard P2PKH, returns the pkh (hex, without
// 0x). Otherwise returns null. RepID tokens are always locked to a plain
// P2PKH (see RFC-001/003), never to P2SH.
function extractP2PKH(lockingBytecode) {
  if (lockingBytecode.length !== 25) return null;
  if (!bytesEqual(lockingBytecode, P2PKH_PREFIX, 0)) return null;
  if (!bytesEqual(lockingBytecode, P2PKH_SUFFIX, 23)) return null;
  return binToHex(lockingBytecode.slice(3, 23));
}

function isEmptyBytes(b) {
  return !b || b.length === 0;
}

// --- Shape recognizers -------------------------------------------------

// IDENTITY_GENESIS (RFC-001), two recognizable shapes:
//
// 1) LEGACY shape (identity_genesis.cash, reader compatibility): 1-2
//    outputs — immutable NFT (capability 'none') with no fungibles locked
//    to P2PKH; optionally a tokenless P2PKH change output. If the second
//    output carries a token, it is not the expected change -> do not
//    recognize.
//
// 2) VAULT shape (identity_vault.cash, collateral): 2 outputs — output 0
//    with the identity NFT (capability 'none', no fungibles, commitment =
//    ownerPkh, readable on-chain because a P2SH does not expose its
//    bytecode) locked TO the covenant (not P2PKH), whose `value` is the
//    initial collateral; output 1 = tokenless P2PKH change to the owner.
//    The indexer tracks the covenant outpoint (identityOutpoint) to later
//    re-identify top-ups and burns. The category always ends up matching
//    the first output's key (the round trip on the same covenant).
function tryDecodeIdentityGenesis(decodedTx, txid) {
  const outCount = decodedTx.outputs.length;
  if (outCount !== 1 && outCount !== 2) return null;
  const out = decodedTx.outputs[0];
  if (!out.token || !out.token.nft) return null;
  if (out.token.nft.capability !== 'none') return null;
  if (out.token.amount !== 0n) return null;
  if (outCount === 2 && decodedTx.outputs[1].token) return null;

  // LEGACY shape: NFT locked to a classic P2PKH.
  const ownerPkh = extractP2PKH(out.lockingBytecode);
  if (ownerPkh) {
    return {
      type: 'IDENTITY_GENESIS',
      txid,
      identityCategory: binToHex(out.token.category),
      ownerPkh,
    };
  }

  // VAULT shape: NFT under the covenant (P2SH) with commitment = ownerPkh.
  const commitment = out.token.nft.commitment;
  if (!commitment || commitment.length !== 20) return null;
  const vaultOwnerPkh = binToHex(commitment);
  if (outCount !== 2) return null;
  const change = extractP2PKH(decodedTx.outputs[1].lockingBytecode);
  if (change !== vaultOwnerPkh) return null; // change must return to the owner

  return {
    type: 'IDENTITY_GENESIS',
    txid,
    identityCategory: binToHex(out.token.category),
    ownerPkh: vaultOwnerPkh,
    collateral: String(out.valueSatoshis),
    identityOutpoint: `${txid}:0`,
  };
}

// Spending of an already-tracked VAULT identity, keyed by the covenant
// outpoint:
//
//   - IDENTITY_COLLATERAL_TOP_UP: the covenant re-commits to itself with
//     the SAME NFT (category + commitment intact) and a value >= the
//     previous one (collateral never decreases on-chain). Tracking moves
//     to the new outpoint. `valid: false` if the value attempts to drop
//     (not minable).
//
//   - IDENTITY_BURNED: the category does not reappear in any output — the
//     NFT is burned and the identity loses validity; the covenant balance
//     returns to the owner's P2PKH. Tracking is removed.
function tryDecodeIdentitySpend(decodedTx, txid, store) {
  for (const input of decodedTx.inputs) {
    const outpoint = `${binToHex(input.outpointTransactionHash)}:${input.outpointIndex}`;
    const identity = store.getIdentity(outpoint);
    if (!identity) continue;

    const category = identity.identityCategory;
    const ownerPkh = identity.ownerPkh;
    const categoryReappears = decodedTx.outputs.some(
      (o) => o.token && binToHex(o.token.category) === category,
    );

    if (!categoryReappears) {
      store.untrackIdentity(outpoint);
      return {
        type: 'IDENTITY_BURNED',
        txid,
        identityCategory: category,
        ownerPkh,
        spentOutpoint: outpoint,
        valid: true,
      };
    }

    // Top-up: the covenant re-locks itself with the same NFT.
    const out0 = decodedTx.outputs[0];
    const hasSameNft = out0.token && binToHex(out0.token.category) === category
      && out0.token.amount === 0n
      && out0.token.nft && binToHex(out0.token.nft.commitment) === ownerPkh;
    const previousCollateral = BigInt(identity.collateral);
    const collateral = BigInt(out0.valueSatoshis);
    const valid = hasSameNft && collateral >= previousCollateral;

    if (valid) {
      store.untrackIdentity(outpoint);
      store.trackIdentity(`${txid}:0`, {
        ownerPkh,
        identityCategory: category,
        collateral: String(collateral),
      });
    }

    return {
      type: 'IDENTITY_COLLATERAL_TOP_UP',
      txid,
      identityCategory: category,
      ownerPkh,
      spentOutpoint: outpoint,
      previousCollateral: String(previousCollateral),
      collateral: String(collateral),
      valid,
    };
  }
  return null;
}

// RECEIPT_GENESIS (RFC-003/004): 3 or 4 outputs, same token category,
// output 0 with empty commitment (Receipt), outputs 1 and 2 with a
// non-empty commitment (Rating Rights) each locked to a different P2PKH;
// a 4th tokenless P2PKH change output is optional (real network). A 4th
// output carrying a token is not the expected change -> do not recognize.
function tryDecodeReceiptGenesis(decodedTx, txid) {
  const outCount = decodedTx.outputs.length;
  if (outCount !== 3 && outCount !== 4) return null;
  const [receipt, rrA, rrB] = decodedTx.outputs;
  if (outCount === 4 && decodedTx.outputs[3].token) return null;

  const outs = [receipt, rrA, rrB];
  if (outs.some((o) => !o.token || !o.token.nft || o.token.amount !== 0n)) return null;

  const category = binToHex(receipt.token.category);
  if (outs.some((o) => binToHex(o.token.category) !== category)) return null;

  if (!isEmptyBytes(receipt.token.nft.commitment)) return null;
  if (isEmptyBytes(rrA.token.nft.commitment) || isEmptyBytes(rrB.token.nft.commitment)) return null;

  const receiptOwnerPkh = extractP2PKH(receipt.lockingBytecode);
  const partyAPkh = extractP2PKH(rrA.lockingBytecode);
  const partyBPkh = extractP2PKH(rrB.lockingBytecode);
  if (!receiptOwnerPkh || !partyAPkh || !partyBPkh) return null;

  const partyARates = binToHex(rrA.token.nft.commitment);
  const partyBRates = binToHex(rrB.token.nft.commitment);

  // Cross-consistency expected by the contract: each Rating Right
  // references the other party's pkh in its commitment.
  if (partyARates !== partyBPkh || partyBRates !== partyAPkh) return null;

  return {
    type: 'RECEIPT_GENESIS',
    txid,
    receiptCategory: category,
    receiptOwnerPkh,
    ratingRights: [
      { outpoint: `${txid}:1`, ownerPkh: partyAPkh, ratesPkh: partyBPkh },
      { outpoint: `${txid}:2`, ownerPkh: partyBPkh, ratesPkh: partyAPkh },
    ],
  };
}

// ISSUED_RATING (RFC-004): flat P2PKH spend of a Rating Right already
// tracked by the indexer, accompanied by an OP_RETURN with the tag and
// the score. The NFT does not reappear in any output -> it is burned
// implicitly, which is precisely what enforces "one rating per
// participant" at the UTXO level.
//
// Score range (SPEC-004 RF-04): only an integer score of 1-5 is allowed.
// If the OP_RETURN score is out of range, the fact is still REcognized
// (so it is not "ignored") but marked `valid: false` — the transaction
// must be treated as invalid at the interpretation level. The range
// constants come from @repid/protocol (MIN_SCORE / MAX_SCORE).

function tryDecodeIssuedRating(decodedTx, txid, lookupRatingRight) {
  const opReturnOut = decodedTx.outputs.find((o) => o.lockingBytecode[0] === OP_RETURN);
  if (!opReturnOut) return null;

  const payload = parseOpReturn(opReturnOut.lockingBytecode);
  if (!payload || payload.tag !== REPID_RATING_TAG) return null;
  if (payload.chunks.length !== 2 || payload.chunks[1].length !== 1) return null;
  const score = payload.chunks[1][0];

  // SPEC-004 RF-04: out-of-range score => the transaction is considered
  // invalid (but still reported, not silently ignored).
  const validScore = score >= MIN_SCORE && score <= MAX_SCORE;

  for (const input of decodedTx.inputs) {
    const outpoint = `${binToHex(input.outpointTransactionHash)}:${input.outpointIndex}`;
    const ratingRight = lookupRatingRight(outpoint);
    if (!ratingRight) continue;

    return {
      type: 'RATING_ISSUED',
      txid,
      spentOutpoint: outpoint,
      raterPkh: ratingRight.ownerPkh,
      rateePkh: ratingRight.ratesPkh,
      score,
      valid: validScore,
    };
  }

  return null;
}

// PLATFORM_CONFIRMATION (SPEC-003 RF-06, pattern C): a validating entity
// (platform/app) corroborates that an interaction happened by spending one
// of its own P2PKH UTXOs with an OP_RETURN: <tag> <Receipt txid (32 bytes)>.
// The confirmation is an independent fact; it does not modify the Receipt
// genesis. If the referenced Receipt is not indexed, the fact is recognized
// but marked `valid: false` (not silently ignored).
function tryDecodePlatformConfirmation(decodedTx, txid, lookupReceipt) {
  const opReturnOut = decodedTx.outputs.find((o) => o.lockingBytecode[0] === OP_RETURN);
  if (!opReturnOut) return null;

  const payload = parseOpReturn(opReturnOut.lockingBytecode);
  if (!payload || payload.tag !== REPID_PLATFORM_TAG) return null;
  if (payload.chunks.length !== 2 || payload.chunks[1].length !== 32) return null;

  // The confirmator is the entity spending its UTXO: its pkh is recovered
  // from the P2PKH scriptSig of the first input.
  const platformPkh = extractPkhFromUnlocking(decodedTx.inputs[0]?.unlockingBytecode);
  if (!platformPkh) return null;

  const receiptTxid = binToHex(payload.chunks[1]);
  return {
    type: 'PLATFORM_CONFIRMATION',
    txid,
    platformPkh,
    receiptTxid,
    valid: Boolean(lookupReceipt(receiptTxid)),
  };
}

// TRUST_LINK (SPEC-006, TASK-018): identity A declares, on-chain and
// unilaterally (without B's consent), that it trusts B. A spends one of its
// own P2PKH UTXOs with OP_RETURN: <tag REPID_TRUST1> <B's pkh, 20 bytes>.
// No Rating Rights are minted; it is a declarative fact. If A == B
// (self-trust), the fact is recognized but marked `valid: false`.
function tryDecodeTrustLink(decodedTx, txid) {
  const opReturnOut = decodedTx.outputs.find((o) => o.lockingBytecode[0] === OP_RETURN);
  if (!opReturnOut) return null;

  const payload = parseOpReturn(opReturnOut.lockingBytecode);
  if (!payload || payload.tag !== REPID_TRUST_TAG) return null;
  if (payload.chunks.length !== 2 || payload.chunks[1].length !== 20) return null;

  const trusterPkh = extractPkhFromUnlocking(decodedTx.inputs[0]?.unlockingBytecode);
  if (!trusterPkh) return null;

  const trustedPkh = binToHex(payload.chunks[1]);
  return {
    type: 'TRUST_LINK',
    txid,
    trusterPkh,
    trustedPkh,
    valid: trustedPkh !== trusterPkh,
  };
}

// Manually decodes the OP_RETURN script (without going through the VM
// again): OP_RETURN <push tag> <push ...>. Returns the tag and the generic
// chunks; each fact recognizer interprets its own shape.
function parseOpReturn(lockingBytecode) {
  let offset = 1; // skip OP_RETURN
  const chunks = [];
  while (offset < lockingBytecode.length) {
    const len = lockingBytecode[offset];
    offset += 1;
    if (len === 0 || len > 75) return null; // only simple direct-pushes
    chunks.push(lockingBytecode.slice(offset, offset + len));
    offset += len;
  }
  if (chunks.length < 2) return null;
  const tag = new TextDecoder().decode(chunks[0]);
  return { tag, chunks };
}

// Extracts the signer's pkh from a standard P2PKH scriptSig
// (<lenSig> <sig> <0x21> <pubkey 33B>). Returns hex or null.
function extractPkhFromUnlocking(unlockingBytecode) {
  if (!unlockingBytecode || unlockingBytecode.length < 35) return null;
  const last = unlockingBytecode.length;
  if (unlockingBytecode[last - 34] !== 0x21) return null; // compressed pubkey push
  const publicKey = unlockingBytecode.slice(last - 33, last);
  return binToHex(hash160(publicKey));
}

// --- Entry point -------------------------------------------------------

/**
 * Indexes a raw RepID transaction.
 *
 * @param {string} rawTxHex - transaction hex (as returned by
 *   TransactionBuilder.send().hex or provider.getRawTransaction).
 * @param {{
 *   getRatingRight: (outpoint: string) => ({ownerPkh: string, ratesPkh: string} | undefined),
 *   trackRatingRight: (outpoint: string, info: {ownerPkh: string, ratesPkh: string}) => void,
 *   getReceipt: (txid: string) => unknown,
 *   trackReceipt: (txid: string, info: object) => void,
 * }} store - index of not-yet-spent Rating Right outpoints and of already
 *   minted Receipt txids. See createMemoryStore() / createJsonFileStore().
 * @returns the recognized fact, or null if the transaction matches no
 *   known RepID shape.
 */
export function indexRawTransaction(rawTxHex, store) {
  const bin = hexToBinLocal(rawTxHex);
  const decoded = decodeTransactionBCH(bin);
  if (typeof decoded === 'string') {
    throw new Error(`Failed to decode transaction: ${decoded}`);
  }

  // We derive the txid from the hex itself: this is what lets us build
  // the outpoints ("txid:vout") of the minted Rating Rights, so that
  // ISSUED_RATING can later find them by spent outpoint.
  const txid = hashTransaction(bin);

  // The spending of a VAULT identity is decoded BEFORE the genesis
  // because a top-up re-emits the NFT toward the covenant with the same
  // shape as a genesis; only the outpoint trail distinguishes both cases.
  const identitySpend = tryDecodeIdentitySpend(decoded, txid, store);
  if (identitySpend) return identitySpend;

  const identity = tryDecodeIdentityGenesis(decoded, txid);
  if (identity) {
    if (identity.identityOutpoint) {
      store.trackIdentity(identity.identityOutpoint, {
        ownerPkh: identity.ownerPkh,
        identityCategory: identity.identityCategory,
        collateral: identity.collateral,
      });
    }
    return identity;
  }

  const receipt = tryDecodeReceiptGenesis(decoded, txid);
  if (receipt) {
    for (const rr of receipt.ratingRights) store.trackRatingRight(rr.outpoint, rr);
    store.trackReceipt(txid, { receiptOwnerPkh: receipt.receiptOwnerPkh });
    return receipt;
  }

  const rating = tryDecodeIssuedRating(decoded, txid, store.getRatingRight);
  if (rating) return rating;

  const confirmation = tryDecodePlatformConfirmation(decoded, txid, store.getReceipt);
  if (confirmation) return confirmation;

  const trust = tryDecodeTrustLink(decoded, txid);
  if (trust) return trust;

  return null;
}

function hexToBinLocal(hex) {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return bytes;
}

export function createMemoryStore() {
  const ratingRights = new Map();
  const receipts = new Map();
  const identities = new Map();
  return {
    trackRatingRight(outpoint, info) {
      ratingRights.set(outpoint, info);
    },
    getRatingRight(outpoint) {
      return ratingRights.get(outpoint);
    },
    trackReceipt(txid, info) {
      receipts.set(txid, info);
    },
    getReceipt(txid) {
      return receipts.get(txid);
    },
    trackIdentity(outpoint, info) {
      identities.set(outpoint, info);
    },
    getIdentity(outpoint) {
      return identities.get(outpoint);
    },
    untrackIdentity(outpoint) {
      identities.delete(outpoint);
    },
    // Internal state view (TASK-020: "Indexer View" panel of the demo).
    snapshot() {
      return {
        ratingRights: [...ratingRights.entries()],
        receipts: [...receipts.entries()],
        identities: [...identities.entries()],
      };
    },
  };
}

// Persistent variant of the store (TASK-004 / Option A): saves the state
// of Rating Rights (and the Receipt index, TASK-016) to a local JSON file
// and reloads it on startup. Being persistent from one transaction to the
// next, it survives process restarts — the bare minimum needed for
// tracing "who already rated" and "which Receipts exist". Real production
// deserves a DB (SQLite or other); that decision is out of scope for the
// MVP (see plan.md §5).
//
// @param filePath - path of the JSON file where state is persisted.
export function createJsonFileStore(filePath) {
  const ratingRights = new Map();
  const receipts = new Map();
  const identities = new Map();

  function load() {
    let raw;
    try {
      raw = readFileSync(filePath, 'utf8');
    } catch (err) {
      // Missing file => first run, we start clean.
      // Any other error (permissions, invalid directory, etc.) is a real
      // failure and must not be hidden.
      if (err.code !== 'ENOENT') throw err;
      return;
    }
    const data = JSON.parse(raw);
    const stored = data && data.ratingRights ? data.ratingRights : {};
    for (const [outpoint, info] of Object.entries(stored)) {
      ratingRights.set(outpoint, info);
    }
    const storedReceipts = data && data.receipts ? data.receipts : {};
    for (const [txid, info] of Object.entries(storedReceipts)) {
      receipts.set(txid, info);
    }
    const storedIdentities = data && data.identities ? data.identities : {};
    for (const [outpoint, info] of Object.entries(storedIdentities)) {
      identities.set(outpoint, info);
    }
  }

  function save() {
    const data = {
      ratingRights: Object.fromEntries(ratingRights),
      receipts: Object.fromEntries(receipts),
      identities: Object.fromEntries(identities),
    };
    writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  }

  load();

  return {
    trackRatingRight(outpoint, info) {
      ratingRights.set(outpoint, info);
      save();
    },
    getRatingRight(outpoint) {
      return ratingRights.get(outpoint);
    },
    trackReceipt(txid, info) {
      receipts.set(txid, info);
      save();
    },
    getReceipt(txid) {
      return receipts.get(txid);
    },
    trackIdentity(outpoint, info) {
      identities.set(outpoint, info);
      save();
    },
    getIdentity(outpoint) {
      return identities.get(outpoint);
    },
    untrackIdentity(outpoint) {
      identities.delete(outpoint);
      save();
    },
    // Useful for forcing a write at a controlled moment (or in tests).
    save,
    // Internal state view (TASK-020: "Indexer View" panel of the demo).
    snapshot() {
      return {
        ratingRights: [...ratingRights.entries()],
        receipts: [...receipts.entries()],
        identities: [...identities.entries()],
      };
    },
  };
}
