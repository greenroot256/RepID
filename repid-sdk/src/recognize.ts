// Fact recognition: decide whether a transaction is one of the eight RepID
// facts, and if so say which and extract its data.
//
// The scope of this module is deliberately narrow. It does not re-validate
// covenant rules: the network already did that when the transaction was mined.
// It recognizes shapes and attributes them. Anything that requires a judgement
// about meaning -- how much a rating is worth, whether two interactions were
// really comparable -- belongs to the interpretation layer, which is not this
// repository's job.
//
// Recognition has exactly three possible outcomes, and collapsing any two of
// them is the characteristic bug of a RepID recognizer:
//
//   1. a fact, possibly with `valid: false`
//   2. not a RepID transaction at all -> null
//   3. an undecodable transaction -> throw
//
// A rating whose score is out of range is case 1 with `valid: false`, never case
// 2. Silently discarding it would erase the record that someone tried.
//
// There is a fourth outcome once binding verification is switched on, and it is
// also case 2: a transaction with the right shape that did not come from the
// canonical covenant. That is a rejection, not a fact marked `valid: false`,
// because `valid: false` already means "recognized but broke a semantic rule" and
// a consumer could not otherwise tell the two apart (SPEC-009 RF-W49).

import { extractP2PKH, extractPkhFromUnlocking, parseOpReturn, toHex } from './bytes.js';
import { MIN_SCORE, MAX_SCORE, OP_RETURN_TAGS } from './constants.js';
import {
  buildP2SH32Hash,
  verifyRedeemScriptBinding,
  verifyVaultOutputBinding,
  type CanonicalCovenant,
  type ConstructorInput,
} from './covenant.js';
import covenantBytecode from './protocol/covenant-bytecode.json' with { type: 'json' };
import {
  categoryAppearsInOutputs,
  decodeRawTransaction,
  findOpReturnOutput,
  type DecodedTransaction,
  type TransactionOutput,
} from './transaction.js';
import type {
  IdentityGenesisFact,
  PlatformConfirmationFact,
  RatingIssuedFact,
  RatingRetractionFact,
  RatingRightRecord,
  ReceiptContext,
  ReceiptGenesisFact,
  RepidFact,
  RepidStateStore,
  TrustLinkFact,
} from './types.js';
import { SUPPORTED_PROTOCOL_VERSIONS } from './version.js';

/**
 * The canonical covenants, synced from the protocol repository.
 *
 * Binding cannot be done without them and cannot be done from the chain: the
 * expected script is a compiler output, so an implementation that wants to verify
 * binding has to be shipped the bytes it is verifying against. Reconstructing
 * them from the transaction under inspection would prove nothing, which is why
 * these are a synced normative input and not something read off the wire.
 */
const RECEIPT = covenantBytecode.contracts.receiptGenesis as CanonicalCovenant;
const RATING_RIGHT = covenantBytecode.contracts.ratingRight as CanonicalCovenant;

/**
 * The identity vault bodies, one per *declared* protocol version (SPEC-010 §5).
 *
 * The vault is the one covenant with two coexisting bodies since `0.4.0`: the
 * pre-`0.4.0` one, with no burn delay, and the `0.4.0` one that gates burning
 * behind `require(this.age >= 144)` (SPEC-008 RF-O831). `0.5.0` changes no
 * covenant, so the registry records the `0.4.0` body under it as well and a
 * deployment bound against either declares the same bytes. SPEC-009 RF-W76 forbids
 * selecting a body by trial matching against the bytes under verification, so
 * this registry is derived from the declared set and nothing is ever added to it
 * from a transaction. A declared version that ships no compiled body fails at
 * load time: a half-synced registry must not degrade silently to shape
 * recognition.
 */
const VAULT_BODIES: ReadonlyMap<string, CanonicalCovenant> = (() => {
  // The versions in covenant-bytecode.json carry the compiled body only; the
  // constructor declaration lives on the vault's entry as a whole, and the
  // reconstruction below gives each version a body that `buildExpectedScript`
  // can serialize.
  const registry = covenantBytecode.contracts.identityVault as unknown as {
    constructorInputs: ConstructorInput[] | undefined;
    versions?: Record<string, { bytecodeHex: string }>;
  };
  if (!registry.constructorInputs) {
    throw new Error(
      'covenant-bytecode.json declares identityVault without constructorInputs; a stale sync cannot bind anything',
    );
  }
  const bodies = new Map<string, CanonicalCovenant>();
  for (const version of SUPPORTED_PROTOCOL_VERSIONS) {
    const compiled = registry.versions?.[version];
    if (!compiled) {
      throw new Error(
        `declared protocol version ${version} has no identity vault body in ` +
          'protocol/covenant-bytecode.json; run scripts/sync-protocol.mjs and rebuild',
      );
    }
    bodies.set(version, {
      bytecodeHex: compiled.bytecodeHex,
      constructorInputs: registry.constructorInputs!,
    });
  }
  return bodies;
})();

/** The single declared vault body for a version, or undefined if not declared. */
function vaultBodyFor(version: string | undefined): CanonicalCovenant | undefined {
  return version === undefined ? undefined : VAULT_BODIES.get(version);
}

/**
 * Which declared version's body a vault genesis' output 0 was deployed under.
 *
 * This is the *one* place the declared bodies are consulted as a set, and it is
 * the point where SPEC-009 RF-W76's "the version recorded when that identity's
 * genesis was recognized" is produced: nothing on chain but the body itself says
 * which of the two declared bodies a deployment carries, so the version cannot
 * be named without looking. That is not the trial matching RF-W56/RF-W76 forbid:
 * at the genesis the emitted fact is the same under either body and nothing the
 * sender spends can change which one is recorded, while every later verification
 * uses the single recorded body. Bodies outside the declared set are never
 * consulted, so a vault from a version this build does not implement fails here
 * (RF-W57).
 */
function vaultVersionForGenesis(
  lockingBytecode: TransactionOutput['lockingBytecode'],
  ownerPkh: string,
): string | undefined {
  for (const version of SUPPORTED_PROTOCOL_VERSIONS) {
    const bound = verifyVaultOutputBinding(lockingBytecode, ownerPkh, VAULT_BODIES.get(version)!);
    if (bound.bound) return version;
  }
  return undefined;
}

/** How strictly to recognize. The default is unchanged, shape-only recognition. */
export interface RecognitionOptions {
  /**
   * Verify that a covenant-backed fact was produced by the canonical covenant,
   * and emit no fact when it was not (SPEC-009 §12).
   *
   * Off by default, and the default is not a fallback: an implementation that
   * never sets this makes no claim about identities at all, only about shapes
   * (SPEC-008 RF-V12). Turning it on makes this recognizer return *fewer* facts,
   * because it rejects impostors that shape recognition alone would report.
   */
  binding?: boolean;
}

/** Reads the pkh of a P2PKH output, or null if it is not one. */
function pkhOf(output: TransactionOutput | undefined): string | null {
  if (!output) return null;
  return extractP2PKH(output.lockingBytecode);
}

/**
 * The 32-byte hash of a P2SH32 locking script, or null if this output is not one.
 *
 * P2SH32 is `OP_HASH256 <32> OP_EQUAL` (0xaa … 0x87), which is the form the
 * CashScript compiler emits for a contract address. P2SH20 (`OP_HASH160 <20>
 * OP_EQUAL`) is a different form and is deliberately not accepted: SPEC-008
 * RF-W825 commits to the compiler's form, and accepting both would let the
 * protocol be satisfied by a lock no deployed covenant can have.
 */
function p2sh32HashOf(output: TransactionOutput | undefined): string | null {
  if (!output) return null;
  const bytecode = output.lockingBytecode;
  if (bytecode.length !== 35) return null;
  if (bytecode[0] !== 0xaa || bytecode[34] !== 0x87) return null;
  return toHex(bytecode.slice(1, 33));
}

/**
 * SPEC-001. Two recognized genesis shapes.
 *
 * LEGACY: one or two outputs, the NFT has capability `none` and no fungibles,
 * locked to a plain P2PKH. A second output carrying a token is not the expected
 * change, so it is not a genesis.
 *
 * VAULT: two outputs, the NFT (capability `none`, commitment = ownerPkh, no
 * fungibles) locked to the covenant rather than to a P2PKH, and a tokenless P2PKH
 * change back to the owner. The covenant outpoint is returned so a later top-up
 * or burn can be recognized.
 */
function recognizeIdentityGenesis(
  tx: DecodedTransaction,
  txid: string,
): IdentityGenesisFact | null {
  const outCount = tx.outputs.length;
  if (outCount !== 1 && outCount !== 2) return null;

  const out = tx.outputs[0];
  if (!out?.token?.nft) return null;
  if (out.token.nft.capability !== 'none') return null;
  if (out.token.amount !== 0n) return null;
  if (outCount === 2 && tx.outputs[1]?.token) return null;

  const category = toHex(out.token.category);

  const legacyOwnerPkh = pkhOf(out);
  if (legacyOwnerPkh) {
    return { type: 'IDENTITY_GENESIS', txid, identityCategory: category, ownerPkh: legacyOwnerPkh };
  }

  // VAULT shape. The covenant is a P2SH, so its bytecode is not on-chain; the
  // identity is bound to its owner by the NFT commitment instead.
  const commitment = out.token.nft.commitment;
  if (!commitment || commitment.length !== 20) return null;
  const vaultOwnerPkh = toHex(commitment);
  if (outCount !== 2) return null;

  // The change must return to the identity's own owner, which is what makes the
  // commitment checkable rather than a bare assertion.
  if (pkhOf(tx.outputs[1]) !== vaultOwnerPkh) return null;

  return {
    type: 'IDENTITY_GENESIS',
    txid,
    identityCategory: category,
    ownerPkh: vaultOwnerPkh,
    collateral: out.valueSatoshis.toString(),
    identityOutpoint: `${txid}:0`,
  };
}

/**
 * The outcome of looking through a transaction's inputs for a tracked vault
 * outpoint.
 *
 * `none` and `rejected` both yield no fact, but they are not the same answer and
 * conflating them is a real hazard: a top-up re-emits the NFT with the same shape
 * as a genesis, so a rejected spend that falls through to genesis recognition is
 * re-read as a brand new identity, and the store ends up tracking an identity that
 * no covenant ever created. `rejected` has to end the transaction where `none`
 * lets it continue.
 */
type SpendOutcome =
  | { kind: 'fact'; fact: RepidFact }
  | { kind: 'none' }
  | { kind: 'rejected' };

/**
 * SPEC-001. The spend of a tracked vault identity, keyed by covenant outpoint.
 *
 * The category not reappearing in any output means the NFT was burned, so the
 * identity is over and the collateral returned to the owner. The category
 * reappearing means the covenant re-locked itself: that is a top-up, and it is
 * valid only if the same NFT came back and the collateral did not decrease.
 *
 * Tracking moves to the new outpoint on success. A collateral decrease is
 * recorded as `valid: false` and leaves the previous tracking in place, because
 * such a transaction cannot be mined: the covenant rejected it. The state is
 * left as it was rather than advanced to a value the chain never accepted.
 */
function recognizeIdentitySpend(
  tx: DecodedTransaction,
  txid: string,
  store: RepidStateStore,
  binding: boolean,
): SpendOutcome {
  for (const input of tx.inputs) {
    const outpoint = `${toHex(input.outpointTransactionHash)}:${input.outpointIndex}`;
    const identity = store.getIdentity(outpoint);
    if (!identity) continue;

    const { identityCategory: category, ownerPkh } = identity;

    // The spend reveals its redeem script, and that script has to be the vault's.
    // Checked here, before any of the tracking below moves, because the
    // alternatives are worse: an impostor would otherwise be recorded as a
    // genuine top-up and the collateral would move to an outpoint the covenant
    // never controls.
    //
    // Which body to compare against is the one recorded when this identity's
    // genesis was recognized (SPEC-009 RF-W76): the identity carries its version
    // forward as it moves, and the revealed script is verified against that
    // single body, never by trying the declared ones until one matches. If no
    // version was recorded (the genesis was recognized without binding), the
    // applicable version is not a declared fact of this run, so the spend is
    // rejected rather than verified against an arbitrary body.
    //
    // A tracked outpoint released with the wrong script (or with no nameable
    // version) is not an identity spend at all, and it ends the transaction.
    // Letting recognition continue would let another input, or the top-up's own
    // re-emitted NFT, still produce a fact — which would make the rejection
    // depend on input order.
    if (binding) {
      const vault = vaultBodyFor(identity.vaultVersion);
      if (!vault) return { kind: 'rejected' };
      const result = verifyRedeemScriptBinding(input.unlockingBytecode, [ownerPkh], vault);
      if (!result.bound) return { kind: 'rejected' };
    }

    if (!categoryAppearsInOutputs(tx, category)) {
      store.untrackIdentity(outpoint);
      return {
        kind: 'fact',
        fact: {
          type: 'IDENTITY_BURNED',
          txid,
          identityCategory: category,
          ownerPkh,
          spentOutpoint: outpoint,
          valid: true,
        },
      };
    }

    const out0 = tx.outputs[0];
    const hasSameNft =
      !!out0?.token &&
      toHex(out0.token.category) === category &&
      out0.token.amount === 0n &&
      !!out0.token.nft &&
      out0.token.nft.commitment !== undefined &&
      out0.token.nft.commitment !== null &&
      toHex(out0.token.nft.commitment) === ownerPkh;

    const previousCollateral = BigInt(identity.collateral);
    const collateral = BigInt(out0?.valueSatoshis ?? 0n);
    const valid = hasSameNft && collateral >= previousCollateral;

    if (valid) {
      store.untrackIdentity(outpoint);
      store.trackIdentity(`${txid}:0`, {
        ownerPkh,
        identityCategory: category,
        collateral: collateral.toString(),
        vaultVersion: identity.vaultVersion,
      });
    }

    return {
      kind: 'fact',
      fact: {
        type: 'IDENTITY_COLLATERAL_TOP_UP',
        txid,
        identityCategory: category,
        ownerPkh,
        spentOutpoint: outpoint,
        previousCollateral: previousCollateral.toString(),
        collateral: collateral.toString(),
        valid,
      },
    };
  }
  return { kind: 'none' };
}

/**
 * SPEC-003 RF-08 and SPEC-009 RF-W73. The optional interaction context carried
 * in the Receipt's NFT commitment, or `null` when the commitment is empty (the
 * legacy form).
 *
 * Only two shapes are facts: 4 bytes with format byte `0x10`, and 36 bytes with
 * format byte `0x11` (which adds the `contextHash`). Any other length or format
 * byte returns `'malformed'`, and the caller must treat that as *no fact*: a
 * receipt genesis carrying a foreign commitment is not recognized, not read as a
 * variant (the format byte's high nibble must be `0x01` and its only defined
 * flag is the `HAS_HASH` bit 0). Unknown `category` or `role` bytes stay raw on
 * the fact — being unknown to this implementation does not make a fact invalid.
 */
function readReceiptContext(
  commitment: Uint8Array | null | undefined,
): ReceiptContext | null | 'malformed' {
  if (!commitment || commitment.length === 0) return null;
  if (commitment.length === 4 && commitment[0] === 0x10) {
    return {
      interactionCategory: toHex(commitment.slice(1, 2)),
      roleA: toHex(commitment.slice(2, 3)),
      roleB: toHex(commitment.slice(3, 4)),
    };
  }
  if (commitment.length === 36 && commitment[0] === 0x11) {
    return {
      interactionCategory: toHex(commitment.slice(1, 2)),
      roleA: toHex(commitment.slice(2, 3)),
      roleB: toHex(commitment.slice(3, 4)),
      contextHash: toHex(commitment.slice(4, 36)),
    };
  }
  return 'malformed';
}

/**
 * SPEC-003 and SPEC-004. Three or four outputs sharing one category: output 0 is
 * the Receipt with an empty commitment or an interaction context, outputs 1 and 2
 * are Rating Rights with a non-empty commitment each, locked to two different
 * P2PKHs. A fourth tokenless P2PKH change output is optional; a fourth output
 * carrying a token is not the expected change and is not recognized.
 *
 * Each Rating Right's commitment names the *other* party, which is what ties a
 * later rating to a counterparty without anyone having to trust this code.
 */
function recognizeReceiptGenesis(
  tx: DecodedTransaction,
  txid: string,
): ReceiptGenesisFact | null {
  const outCount = tx.outputs.length;
  if (outCount !== 3 && outCount !== 4) return null;
  if (outCount === 4 && tx.outputs[3]?.token) return null;

  const [receipt, rrA, rrB] = tx.outputs;
  if (!receipt || !rrA || !rrB) return null;

  const outs = [receipt, rrA, rrB];
  if (outs.some((o) => !o.token?.nft || o.token.amount !== 0n)) return null;
  // RF-W39 requires capability `none` on all three, and the identity path already
  // enforces it. A `mutable` or `minting` NFT in a receipt genesis would let the
  // category be reissued after the fact, which is the opposite of what a Receipt
  // claims to be, so the shape is rejected rather than accepted as a variant.
  if (outs.some((o) => o.token!.nft!.capability !== 'none')) return null;

  const category = toHex(receipt.token!.category);
  if (outs.some((o) => toHex(o.token!.category) !== category)) return null;

  const isEmpty = (bytes: Uint8Array | null | undefined): boolean =>
    !bytes || bytes.length === 0;

  // The interaction context, decoded per SPEC-009 RF-W73. A commitment that is
  // neither empty, nor a 4-byte `0x10` form, nor a 36-byte `0x11` form makes the
  // whole genesis unrecognized: it has the shape of a RepID Receipt carrying a
  // payload the protocol does not define.
  const context = readReceiptContext(receipt.token!.nft!.commitment);
  if (context === 'malformed') return null;
  if (isEmpty(rrA.token!.nft!.commitment) || isEmpty(rrB.token!.nft!.commitment)) return null;

  // SPEC-009 RF-W58. Since 0.3.0 both Rating Rights sit under RatingRightVault
  // (SPEC-008 RF-O822), so their locking bytecode is a P2SH32 and not a P2PKH.
  // A receipt genesis with its rights in P2PKH is the 0.2.x form and is not
  // recognized here, which is what makes RF-W57 a fact about the shape rather
  // than only about the bytecode.
  const vaultForA = p2sh32HashOf(rrA);
  const vaultForB = p2sh32HashOf(rrB);
  if (!vaultForA || !vaultForB) return null;
  if (vaultForA === vaultForB) return null;

  // The holder of a covenant-locked right is not on chain: a P2SH output carries
  // only a hash, and the constructor argument naming the holder is revealed when
  // the covenant is spent. The parties are therefore derived from the two things
  // that *are* on chain. Output 0 is a P2PKH to partyA, and output 1's commitment
  // names the party its holder may rate, which is partyB.
  const receiptOwnerPkh = pkhOf(receipt);
  if (!receiptOwnerPkh) return null;
  const partyAPkh = receiptOwnerPkh;
  const partyBPkh = toHex(rrA.token!.nft!.commitment!);

  // The cross pair. Output 2's commitment must name partyA, or the pair is not the
  // pair and there is no counterparty relationship to record.
  if (toHex(rrB.token!.nft!.commitment!) !== partyAPkh) return null;

  // A self-receipt satisfies every check above and would attest that a wallet
  // interacted with itself. Read from the outputs, so it holds with binding off as
  // well; the covenant refuses it too (SPEC-008 RF-O821).
  if (partyAPkh === partyBPkh) return null;

  const receiptContext = context ?? undefined;
  const fact: ReceiptGenesisFact = {
    type: 'RECEIPT_GENESIS',
    txid,
    receiptCategory: category,
    receiptOwnerPkh,
    ratingRights: [
      { outpoint: `${txid}:1`, ownerPkh: partyAPkh, ratesPkh: partyBPkh },
      { outpoint: `${txid}:2`, ownerPkh: partyBPkh, ratesPkh: partyAPkh },
    ],
  };
  if (receiptContext) fact.receiptContext = receiptContext;
  return fact;
}

/**
 * SPEC-004. A flat P2PKH spend of an already-tracked Rating Right, carrying an
 * OP_RETURN with the tag and a one-byte score. The NFT does not reappear in any
 * output, so it is burned by being spent: that is precisely what enforces one
 * rating per participant at the UTXO level, with no covenant needed.
 *
 * Two payload forms share this recognizer (SPEC-009 §7, RF-W23 step 4): the
 * two-chunk `REPID_RATING1` and the three-chunk `REPID_RATING2`, which adds a
 * 32-byte `commentHash`. The tag selects the form; a `REPID_RATING2` that is not
 * exactly `byte[1] + byte[32]` is a malformed container and yields no fact
 * (RF-W65), never a reading of the empty slot.
 *
 * An out-of-range score is still recognized, marked `valid: false`. The rating
 * happened; whether it counts is the interpretation layer's decision, not this
 * module's.
 */
function recognizeRatingIssued(
  tx: DecodedTransaction,
  txid: string,
  store: RepidStateStore,
  binding: boolean,
): RatingIssuedFact | null {
  const opReturnOut = findOpReturnOutput(tx);
  if (!opReturnOut) return null;

  const payload = parseOpReturn(opReturnOut.lockingBytecode);
  if (!payload) return null;
  const isRating1 = payload.tag === OP_RETURN_TAGS.RATING;
  const isRating2 = payload.tag === OP_RETURN_TAGS.RATING2;
  if (!isRating1 && !isRating2) return null;
  if ((isRating1 && payload.chunks.length !== 2) || (isRating2 && payload.chunks.length !== 3)) {
    return null;
  }

  const scoreChunk = payload.chunks[1];
  if (!scoreChunk || scoreChunk.length !== 1) return null;
  const score = scoreChunk[0] as number;

  let commentHash: string | undefined;
  if (isRating2) {
    const commentChunk = payload.chunks[2];
    if (!commentChunk || commentChunk.length !== 32) return null;
    commentHash = toHex(commentChunk);
  }

  const validScore = score >= MIN_SCORE && score <= MAX_SCORE;

  for (const input of tx.inputs) {
    const outpoint = `${toHex(input.outpointTransactionHash)}:${input.outpointIndex}`;
    const ratingRight = store.getRatingRight(outpoint);
    if (!ratingRight) continue;

    // SPEC-009 RF-W59. The Rating Right is a covenant UTXO, and the covenant
    // is what makes it single-use, so tracking the outpoint is not enough on
    // its own: an impostor script that reveals itself here could move the NFT
    // on to a new output, and the rating would then be recognized a second
    // time against that new output if it were ever registered. Verifying the
    // reveal against the canonical RatingRightVault bytecode is what ties this
    // fact to the one-path covenant, and where binding applies the stray reveal
    // yields *no fact* (RF-W49): the "recreate the NFT and rate again" shape is
    // exactly what must not be publishable.
    if (binding) {
      const result = verifyRedeemScriptBinding(
        input.unlockingBytecode,
        [ratingRight.ownerPkh],
        RATING_RIGHT,
      );
      if (!result.bound) return null;
    }

    // The Rating Right is single-use, and this transaction spent it: the NFT
    // appears in no output, so it is burned. Retiring the outpoint is a
    // statement about the chain, not about the rating, so it happens for an
    // out-of-range score exactly as it does for a good one. Leaving it tracked
    // would let the same right be recognized as rated more than once, which
    // contradicts the one-rating-per-participant property the burn exists to
    // provide.
    store.consumeRatingRight(outpoint);

    // The ratings index (SPEC-005 RF-27). Neither rating payload names its
    // Receipt, but the right being spent was minted by one: its outpoint txid is
    // the Receipt's own txid, so the reference travels with the fact. This is
    // what a later REPID_RETRACT1 is corroborated against.
    const receiptTxid = outpoint.split(':')[0]!;
    store.recordRating(ratingRight.ownerPkh, receiptTxid);

    const fact: RatingIssuedFact = {
      type: 'RATING_ISSUED',
      txid,
      spentOutpoint: outpoint,
      raterPkh: ratingRight.ownerPkh,
      rateePkh: ratingRight.ratesPkh,
      score,
      ...(commentHash ? { commentHash } : {}),
      valid: validScore,
    };
    return fact;
  }

  return null;
}

/**
 * SPEC-003 RF-06. A validating entity corroborates that an interaction happened
 * by spending one of its own P2PKH UTXOs with an OP_RETURN naming the Receipt's
 * txid. The confirmation is a separate fact; it does not modify the Receipt.
 *
 * `valid` is true only when the Receipt is indexed *and* the confirming entity is
 * not one of its parties (SPEC-003 RF-10, SPEC-009 RF-W71): a party cannot
 * corroborate its own interaction. Both failures are reported, never dropped —
 * an unknown Receipt is a claim this recognizer cannot corroborate, and a party
 * confirming itself is a rejected claim, and a consumer needs to tell the two
 * apart.
 */
function recognizePlatformConfirmation(
  tx: DecodedTransaction,
  txid: string,
  store: RepidStateStore,
): PlatformConfirmationFact | null {
  const opReturnOut = findOpReturnOutput(tx);
  if (!opReturnOut) return null;

  const payload = parseOpReturn(opReturnOut.lockingBytecode);
  if (!payload || payload.tag !== OP_RETURN_TAGS.PLATFORM) return null;
  if (payload.chunks.length !== 2) return null;

  const receiptTxidChunk = payload.chunks[1];
  if (!receiptTxidChunk || receiptTxidChunk.length !== 32) return null;

  // The confirming entity is whoever signed: its pkh comes from the P2PKH
  // scriptSig of the first input, so no Identity is required to confirm.
  const platformPkh = extractPkhFromUnlocking(tx.inputs[0]?.unlockingBytecode);
  if (!platformPkh) return null;

  const receiptTxid = toHex(receiptTxidChunk);
  const receipt = store.getReceipt(receiptTxid);
  const valid =
    !!receipt &&
    receipt.receiptOwnerPkh !== platformPkh &&
    receipt.partyBPkh !== platformPkh;

  return {
    type: 'PLATFORM_CONFIRMATION',
    txid,
    platformPkh,
    receiptTxid,
    valid,
  };
}

/**
 * SPEC-004 RF-06/RF-07. A rater unilaterally retracts a rating it issued by
 * spending one of its own P2PKH UTXOs with an OP_RETURN naming the rating's
 * Receipt. The original `RATING_ISSUED` is never deleted; the retraction is an
 * independent fact that reframes how the chain is read, it does not rescind it.
 *
 * The reference is corroborated against the ratings index (SPEC-005 RF-27): a
 * rating this recognizer recorded for this rater and this Receipt. An unknown
 * reference (RF-W68), a spender who is not the rating's signer (RF-W69) and a
 * repeat of an already-retracted rating (RF-W70) all yield `valid: false`. The
 * store answer settles RF-W68 and RF-W69 together, because the index only ever
 * holds ratings under the pkh of the rater who signed them.
 *
 * Only a *valid* retraction enters the retracted set. Recording every invalid
 * attempt would let an attacker spend one UTXO to permanently block a rater from
 * ever retracting its rating — the deterministic rule RF-W72 describes is kept
 * for the retraction that actually happens, and it applies at most once.
 */
function recognizeRatingRetraction(
  tx: DecodedTransaction,
  txid: string,
  store: RepidStateStore,
): RatingRetractionFact | null {
  const opReturnOut = findOpReturnOutput(tx);
  if (!opReturnOut) return null;

  const payload = parseOpReturn(opReturnOut.lockingBytecode);
  if (!payload || payload.tag !== OP_RETURN_TAGS.RETRACT) return null;
  if (payload.chunks.length !== 2) return null;

  const receiptChunk = payload.chunks[1];
  if (!receiptChunk || receiptChunk.length !== 32) return null;

  // The declarer is whoever signed, resolved per SPEC-009 §5: the first input's
  // compressed public key, hashed. A retraction needs no Rating Right to spend:
  // the one that issued the rating was destroyed with it.
  const raterPkh = extractPkhFromUnlocking(tx.inputs[0]?.unlockingBytecode);
  if (!raterPkh) return null;

  const receiptTxid = toHex(receiptChunk);

  const knownRating = store.hasRating(raterPkh, receiptTxid);
  const repeated = knownRating && store.isRatingRetracted(raterPkh, receiptTxid);
  const valid = knownRating && !repeated;

  if (valid) store.recordRatingRetraction(raterPkh, receiptTxid);

  return {
    type: 'RATING_RETRACTION',
    txid,
    raterPkh,
    receiptTxid,
    valid,
  };
}

/**
 * SPEC-006. A unilaterally declares that it trusts B, spending one of A's own
 * P2PKH UTXOs with an OP_RETURN carrying B's pkh. No Rating Rights are minted
 * and B never consents, which is what makes this usable to address a cold start:
 * an identity with no ratings can still be endorsed.
 *
 * A trusting itself is reported with `valid: false`.
 */
function recognizeTrustLink(tx: DecodedTransaction, txid: string): TrustLinkFact | null {
  const opReturnOut = findOpReturnOutput(tx);
  if (!opReturnOut) return null;

  const payload = parseOpReturn(opReturnOut.lockingBytecode);
  if (!payload || payload.tag !== OP_RETURN_TAGS.TRUST) return null;
  if (payload.chunks.length !== 2) return null;

  const trustedChunk = payload.chunks[1];
  if (!trustedChunk || trustedChunk.length !== 20) return null;

  const trusterPkh = extractPkhFromUnlocking(tx.inputs[0]?.unlockingBytecode);
  if (!trusterPkh) return null;

  const trustedPkh = toHex(trustedChunk);
  return {
    type: 'TRUST_LINK',
    txid,
    trusterPkh,
    trustedPkh,
    valid: trustedPkh !== trusterPkh,
  };
}

/**
 * Recognizes one raw RepID transaction.
 *
 * @param rawTxHex - transaction hex, with or without a `0x` prefix.
 * @param store - retained state. Rating Right outpoints, Receipt txids, the
 * ratings index and the retracted set accumulated by earlier transactions are
 * what let a rating be attributed to the right parties, a confirmation be
 * checked and a retraction be corroborated; the store is updated as a side
 * effect of recognizing the transaction.
 * @param options - pass `binding: true` to verify covenant linkage (SPEC-009
 * §12). Off by default.
 * @returns the recognized fact, or `null` if the transaction matches no known
 * RepID shape — or, with binding on, if it matches the shape of a
 * covenant-backed fact without having come from the covenant. Throws if the hex
 * cannot be decoded, because a transaction that cannot be read is not the same
 * as a transaction that is not a fact.
 *
 * The order below is the recognition precedence (SPEC-009 §7, RF-W23) and is
 * normative: a vault spend is examined before a genesis because a top-up
 * re-emits the NFT toward the covenant with the same shape as a genesis, and
 * only the outpoint trail distinguishes the two; the retraction (step 6) needs
 * the rating of the referenced Receipt to have been seen, so it follows the
 * rating recognizer.
 *
 * Every binding check runs *before* this function touches the store. That ordering
 * is the whole point: a rejected transaction must leave no trace, or the index
 * would end up holding an identity or a Rating Right that no covenant ever
 * created.
 */
export function indexRawTransaction(
  rawTxHex: string,
  store: RepidStateStore,
  options: RecognitionOptions = {},
): RepidFact | null {
  const { txid, tx } = decodeRawTransaction(rawTxHex);
  const binding = options.binding === true;

  const identitySpend = recognizeIdentitySpend(tx, txid, store, binding);
  if (identitySpend.kind === 'fact') return identitySpend.fact;
  if (identitySpend.kind === 'rejected') return null;

  const identityGenesis = recognizeIdentityGenesis(tx, txid);
  if (identityGenesis) {
    // Only the vault form is bound. A legacy genesis has no covenant in it at
    // all, so there is nothing to compare and nothing to reject: it stays a
    // recognized fact and, because it is never tracked, it never becomes an
    // identity (SPEC-008 RF-V13, SPEC-009 RF-W53).
    if (identityGenesis.identityOutpoint) {
      let vaultVersion: string | undefined;
      if (binding) {
        // The recorded version is the declared fact RF-W76 requires: the
        // identity's later spends are verified against this one body, and the
        // store keeps it as long as the identity is tracked.
        vaultVersion = vaultVersionForGenesis(
          tx.outputs[0]!.lockingBytecode,
          identityGenesis.ownerPkh,
        );
        if (!vaultVersion) return null;
      }
      store.trackIdentity(identityGenesis.identityOutpoint, {
        ownerPkh: identityGenesis.ownerPkh,
        identityCategory: identityGenesis.identityCategory,
        collateral: identityGenesis.collateral ?? '0',
        vaultVersion,
      });
    }
    return identityGenesis;
  }

  const receipt = recognizeReceiptGenesis(tx, txid);
  if (receipt) {
    if (binding) {
      // The genesis input, at vout 0 of its source: that is where the covenant
      // reveals itself, and it is also the input whose outpoint txid becomes the
      // category.
      //
      // The last two constructor arguments are the P2SH20 hashes of
      // RatingRightVault for each party (SPEC-008 RF-O825). They are derived here
      // from the canonical bytecode and the parties already read off the outputs,
      // never copied from the transaction: taking them from the bytes under
      // verification would make the comparison agree with whatever it was handed
      // (RF-W56).
      const ratingRightHashes = receipt.ratingRights.map((right) =>
        buildP2SH32Hash(RATING_RIGHT, [right.ownerPkh]),
      );
      const genesisInput = tx.inputs.find((input) => input.outpointIndex === 0);
      const result = genesisInput
        ? verifyRedeemScriptBinding(
            genesisInput.unlockingBytecode,
            [...receipt.ratingRights.map((right) => right.ownerPkh), ...ratingRightHashes],
            RECEIPT,
          )
        : null;
      if (!result?.bound) return null;
    }
    for (const right of receipt.ratingRights) {
      store.trackRatingRight(right.outpoint, right as RatingRightRecord);
    }
    // Both parties are retained so the self-corroboration rule (SPEC-003 RF-10,
    // SPEC-009 RF-W71) can be checked against a tracked Receipt, and the
    // interaction context is retained because later reads of it depend on this
    // index (SPEC-005 RF-23/RF-74).
    const receiptRecord: { receiptOwnerPkh: string; partyBPkh: string; receiptContext?: ReceiptContext } = {
      receiptOwnerPkh: receipt.receiptOwnerPkh,
      partyBPkh: receipt.ratingRights[1]!.ownerPkh,
    };
    if (receipt.receiptContext) receiptRecord.receiptContext = receipt.receiptContext;
    store.trackReceipt(txid, receiptRecord);
    return receipt;
  }

  const rating = recognizeRatingIssued(tx, txid, store, binding);
  if (rating) return rating;

  const confirmation = recognizePlatformConfirmation(tx, txid, store);
  if (confirmation) return confirmation;

  const retraction = recognizeRatingRetraction(tx, txid, store);
  if (retraction) return retraction;

  return recognizeTrustLink(tx, txid);
}
