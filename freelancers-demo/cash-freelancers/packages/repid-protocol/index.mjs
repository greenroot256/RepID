// @repid/protocol — RepID protocol constants
//
// Single source of truth for the protocol-level constants that any RepID
// implementation shares: on-chain OP_RETURN tags, the score range and the
// recognized fact types. The indexer and the reference server consume this
// package instead of redefining these values, so a later extraction of the
// protocol or the indexer keeps a single normative source.
//
// SPEC-008 (normative core) defines the events and their field schemas;
// these constants are the machine-readable values the specs reference.

// OP_RETURN tags that distinguish RepID facts from any other OP_RETURN
// usage on the same chain. Chosen as human-readable UTF-8 strings; the
// value carries no cryptographic commitment whatsoever.
export const REPID_RATING_TAG = 'REPID_RATING1';
export const REPID_PLATFORM_TAG = 'REPID_PLATFORM1';
export const REPID_TRUST_TAG = 'REPID_TRUST1';

// SPEC-004 RF-04: an issued rating is valid only for an integer score in
// the 1–5 range.
export const MIN_SCORE = 1;
export const MAX_SCORE = 5;

// The protocol fact types the indexer can recognize (SPEC-008 §3).
export const FACT_TYPES = Object.freeze([
  'IDENTITY_GENESIS',
  'IDENTITY_COLLATERAL_TOP_UP',
  'IDENTITY_BURNED',
  'RECEIPT_GENESIS',
  'RATING_ISSUED',
  'PLATFORM_CONFIRMATION',
  'TRUST_LINK',
]);