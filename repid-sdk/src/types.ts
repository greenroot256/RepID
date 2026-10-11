// The eight RepID fact types, and the state a recognizer must retain to derive
// them deterministically.
//
// Field sets here are closed on purpose. The JSON Schema in
// `src/protocol/schemas/repid-fact.schema.json` is the normative definition and
// rejects unknown fields; these types mirror it, and a test validates every
// emitted fact against the Schema so the two cannot drift apart silently.
//
// Amounts are strings, never numbers. A satoshi amount can exceed
// Number.MAX_SAFE_INTEGER, and a reputation value computed from a rounded
// collateral is a wrong reputation value that looks right.

/** A 20-byte public key hash, lowercase hex, no `0x`. */
export type Pkh = string;

/** A 32-byte transaction id, lowercase hex, no `0x`. Order is display order. */
export type Txid = string;

/** A 32-byte CashTokens category id, lowercase hex, no `0x`. */
export type Category = string;

/** Satoshis, as a decimal string so no precision is lost. */
export type AmountString = string;

/** A `txid:vout` outpoint, the key the retained state is indexed by. */
export type Outpoint = string;

/**
 * SPEC-001. Two recognized shapes, distinguished by the presence of
 * `collateral`: the legacy P2PKH genesis, and the vault genesis where the NFT
 * is locked to the covenant together with collateral.
 */
export interface IdentityGenesisFact {
  type: 'IDENTITY_GENESIS';
  txid: Txid;
  identityCategory: Category;
  ownerPkh: Pkh;
  /** Present only for the vault shape; the legacy shape has no collateral. */
  collateral?: AmountString;
  /** Present only for the vault shape: the covenant UTXO to track. */
  identityOutpoint?: Outpoint;
}

/** SPEC-001. `valid: false` marks a top-up that attempted to decrease. */
export interface IdentityCollateralTopUpFact {
  type: 'IDENTITY_COLLATERAL_TOP_UP';
  txid: Txid;
  identityCategory: Category;
  ownerPkh: Pkh;
  spentOutpoint: Outpoint;
  previousCollateral: AmountString;
  collateral: AmountString;
  valid: boolean;
}

/** SPEC-001. The category does not reappear, so the identity is gone. */
export interface IdentityBurnedFact {
  type: 'IDENTITY_BURNED';
  txid: Txid;
  identityCategory: Category;
  ownerPkh: Pkh;
  spentOutpoint: Outpoint;
  valid: boolean;
}

/** One of the two single-use Rating Rights a Receipt genesis mints. */
export interface RatingRightRecord {
  outpoint: Outpoint;
  ownerPkh: Pkh;
  ratesPkh: Pkh;
}

/**
 * SPEC-003 RF-08. The optional interaction context decoded from the Receipt's
 * NFT commitment (SPEC-009 §9.2). `interactionCategory`, `roleA` and `roleB` are
 * single bytes preserved raw (tolerant reading), and `contextHash` is present
 * only in the 36-byte `0x11` form.
 */
export interface ReceiptContext {
  interactionCategory: string;
  roleA: string;
  roleB: string;
  contextHash?: string;
}

/** SPEC-003. Requires both parties' signatures, by construction of the shape. */
export interface ReceiptGenesisFact {
  type: 'RECEIPT_GENESIS';
  txid: Txid;
  receiptCategory: Category;
  receiptOwnerPkh: Pkh;
  ratingRights: [RatingRightRecord, RatingRightRecord];
  /** Present only when the NFT commitment carried an interaction context. */
  receiptContext?: ReceiptContext;
}

/**
 * SPEC-004. The Rating Right is burned by being spent, which is what enforces
 * one rating per participant at the UTXO level. `score` is reported as decoded
 * even when out of range; `valid` says whether it was inside 1-5. A spend with
 * `REPID_RATING2` additionally carries the 32-byte `commentHash`; with
 * `REPID_RATING1` the field is absent.
 */
export interface RatingIssuedFact {
  type: 'RATING_ISSUED';
  txid: Txid;
  spentOutpoint: Outpoint;
  raterPkh: Pkh;
  rateePkh: Pkh;
  score: number;
  commentHash?: string;
  valid: boolean;
}

/**
 * SPEC-004 RF-06/RF-07. A rater unilaterally retracts a rating it issued, by
 * spending its own P2PKH UTXO with `REPID_RETRACT1` naming the rating's Receipt
 * (SPEC-009 §4.5). The original `RATING_ISSUED` is never deleted; `valid: false`
 * marks an unknown reference, a spender who was not the rater, or a repeated
 * retraction of the same rating.
 */
export interface RatingRetractionFact {
  type: 'RATING_RETRACTION';
  txid: Txid;
  raterPkh: Pkh;
  receiptTxid: Txid;
  valid: boolean;
}

/**
 * SPEC-003 RF-06. An independent fact, not a modification of the Receipt.
 * `valid: false` when the referenced Receipt has not been indexed, which is a
 * claim this recognizer cannot corroborate rather than a proven falsehood.
 */
export interface PlatformConfirmationFact {
  type: 'PLATFORM_CONFIRMATION';
  txid: Txid;
  platformPkh: Pkh;
  receiptTxid: Txid;
  valid: boolean;
}

/** SPEC-006. Unilateral, so consent is impossible; self-trust is invalid. */
export interface TrustLinkFact {
  type: 'TRUST_LINK';
  txid: Txid;
  trusterPkh: Pkh;
  trustedPkh: Pkh;
  valid: boolean;
}

export type RepidFact =
  | IdentityGenesisFact
  | IdentityCollateralTopUpFact
  | IdentityBurnedFact
  | ReceiptGenesisFact
  | RatingIssuedFact
  | PlatformConfirmationFact
  | RatingRetractionFact
  | TrustLinkFact;

export type FactType = RepidFact['type'];

/**
 * A fact that this recognizer can assert to have found on chain. Downstream
 * code that must not act on an unverifiable claim filters on `valid`, which is
 * the difference between "recognized" and "true".
 */
export type ValidatedFact = Extract<RepidFact, { valid: true }>;

/**
 * What is retained about a tracked identity between transactions.
 *
 * Its presence in the store *is* the identity. Nothing else records that a party
 * has one, and nothing derived from it may be treated as an identity either.
 */
export interface IdentityRecord {
  ownerPkh: Pkh;
  identityCategory: Category;
  collateral: AmountString;
  /**
   * The protocol version whose vault body minted this identity, recorded at
   * genesis when binding is on (SPEC-009 RF-W76). The identity carries it
   * forward across top-ups, so every later spend is verified against that one
   * body instead of any other.
   */
  vaultVersion?: string;
}

/**
 * What is retained about a Receipt, so confirmations can be corroborated.
 *
 * Both parties are kept because a valid `PLATFORM_CONFIRMATION` cannot come from
 * either party of the Receipt it names (SPEC-003 RF-10, SPEC-009 RF-W71), and
 * the interaction context is kept because later reads of it depend on the
 * Receipt index (SPEC-005 RF-23).
 */
export interface ReceiptRecord {
  /** partyA: the P2PKH holder of output 0. */
  receiptOwnerPkh: Pkh;
  /** partyB: the counterparty, from the Rating Rights' cross pair. */
  partyBPkh: Pkh;
  receiptContext?: ReceiptContext;
}

/** What a Rating Right entitles its holder to do, without naming it. */
export type RatingRightInfo = Omit<RatingRightRecord, 'outpoint'>;

/**
 * One entry of the ratings index and of the retracted set (SPEC-005 RF-27).
 *
 * The index answers "did this rater really rate against this Receipt", which is
 * what turns a `REPID_RETRACT1` reference into a corroborable claim. The set of
 * retractions is keyed the same way, so two parties rating the same Receipt
 * retract independently of each other.
 */
export interface RatingRecord {
  raterPkh: Pkh;
  receiptTxid: Txid;
}

/**
 * The state SPEC-005 requires a recognizer to retain.
 *
 * Retaining it is normative, but the *mechanism* is not: the protocol requires
 * that Rating Right outpoints be remembered so a later rating can be attributed
 * to the right parties, and that Receipt txids be remembered so a confirmation
 * can be checked. Whether that is a Map, a file or a database is an
 * implementation choice, which is why this is an interface.
 *
 * `trackRatingRight` takes the outpoint as the key and the rest of the record
 * separately, and the store builds the full record itself. Accepting the
 * outpoint in both places would let a caller store a record that contradicts
 * the key it was filed under, which is a wrong-fact generator that no type
 * checker can catch once both are `string`.
 *
 * `consumeRatingRight` exists because a Rating Right is single-use. Without it
 * the same outpoint can be recognized as rated more than once, which contradicts
 * the one-rating-per-participant property the burn is there to provide.
 */
export interface RepidStateStore {
  getRatingRight(outpoint: Outpoint): RatingRightRecord | undefined;
  trackRatingRight(outpoint: Outpoint, info: RatingRightInfo): void;
  consumeRatingRight(outpoint: Outpoint): void;

  getReceipt(txid: Txid): ReceiptRecord | undefined;
  trackReceipt(txid: Txid, record: ReceiptRecord): void;

  /**
   * The ratings index, SPEC-005 RF-27. `RATING_ISSUED` recognition records
   * `(raterPkh, receiptTxid)` so a later `REPID_RETRACT1` can be corroborated
   * against a rating that actually exists and was signed by the spender.
   */
  hasRating(raterPkh: Pkh, receiptTxid: Txid): boolean;
  recordRating(raterPkh: Pkh, receiptTxid: Txid): void;

  /**
   * The retracted set. A `REPID_RETRACT1` that references an already-retracted
   * rating is emitted with `valid: false`; only a *valid first* retraction is
   * recorded, so a malformed or premature retraction cannot burn a later,
   * legitimate one (SPEC-004 RF-07).
   */
  isRatingRetracted(raterPkh: Pkh, receiptTxid: Txid): boolean;
  recordRatingRetraction(raterPkh: Pkh, receiptTxid: Txid): void;

  getIdentity(outpoint: Outpoint): IdentityRecord | undefined;
  /**
   * The identity held by `ownerPkh`, if any.
   *
   * This is what answers "does this party have a RepID identity", which the
   * outpoint-keyed lookup cannot: a consumer holds a pkh, not an outpoint, and
   * making it reconstruct outpoints would mean keeping a second map that could
   * disagree with the first.
   *
   * It returns `undefined` for a legacy genesis, and that is the intended
   * reading rather than a missing case. A legacy genesis is recognized as a fact
   * but is never tracked, so it never established an identity (SPEC-008 RF-V13).
   */
  getIdentityByOwner(ownerPkh: Pkh): IdentityRecord | undefined;
  trackIdentity(outpoint: Outpoint, record: IdentityRecord): void;
  untrackIdentity(outpoint: Outpoint): void;

  /** An inspectable view of the retained state, for debugging and tests. */
  snapshot(): RepidStateSnapshot;
}

export interface RepidStateSnapshot {
  ratingRights: Array<[Outpoint, RatingRightRecord]>;
  receipts: Array<[Txid, ReceiptRecord]>;
  identities: Array<[Outpoint, IdentityRecord]>;
  ratings: Array<[string, RatingRecord]>;
  retractions: Array<[string, RatingRecord]>;
}
