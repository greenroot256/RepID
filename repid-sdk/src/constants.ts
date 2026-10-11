// Protocol constants, loaded from the normative file copied out of the
// repid-protocol repository.
//
// The values are not written here on purpose. They live in
// `repid-protocol/protocol/constants.json`, are copied by
// `scripts/sync-protocol.mjs`, and `scripts/check-drift.mjs` proves the copy
// still matches. A second hand-written definition of the tags or the score
// range would be a second truth, which is the failure this split exists to
// prevent.

import constantsJson from './protocol/constants.json' with { type: 'json' };
import protocolVersionJson from './protocol/protocol-version.json' with { type: 'json' };
import type { FactType } from './types.js';

export const PROTOCOL_NAME: string = constantsJson.protocolName;

/**
 * The protocol version this build of the SDK implements, and its status.
 *
 * A consumer that needs to know whether a fact set was read under a given set of
 * recognition rules has no other way to find out. `status` is carried alongside
 * the number on purpose: `0.1.0` does not mean "stable, maybe with bugs", it
 * means pre-release, and SPEC-010 requires that to be visible to whoever depends
 * on it. Reporting only the number would invite exactly the misreading the
 * status exists to prevent.
 */
export const PROTOCOL_VERSION: string = protocolVersionJson.version;
export const PROTOCOL_STATUS: string = protocolVersionJson.status;

/** The specification documents this build was written against. */
export const PROTOCOL_SPECIFICATION: readonly string[] = Object.values(
  protocolVersionJson.specification as Record<string, string>,
);

/**
 * The OP_RETURN tags that mark a transaction as a RepID fact rather than
 * arbitrary application data. These values are push-only ASCII; a transaction
 * carrying one of them in any other encoding is not a RepID fact.
 *
 * Five tags since `0.4.0`: `RATING2` (`REPID_RATING2`) attaches a 32-byte
 * `commentHash`, and `RETRACT` (`REPID_RETRACT1`) retracts a rating by naming
 * its Receipt (SPEC-009 §4).
 */
export const OP_RETURN_TAGS = {
  RATING: constantsJson.opReturnTags.RATING.value,
  RATING2: constantsJson.opReturnTags.RATING2.value,
  RETRACT: constantsJson.opReturnTags.RETRACT.value,
  PLATFORM: constantsJson.opReturnTags.PLATFORM.value,
  TRUST: constantsJson.opReturnTags.TRUST.value,
} as const;

export type OpReturnTagKey = keyof typeof OP_RETURN_TAGS;

/**
 * Inclusive score bounds for a valid rating (SPEC-004 RF-04).
 *
 * A score outside this range does not make a fact disappear: it is emitted with
 * `valid: false`. That distinction is load-bearing, and a recognizer that
 * throws or returns null here loses the evidence that someone tried.
 */
export const MIN_SCORE = constantsJson.scoreRange.MIN_SCORE;
export const MAX_SCORE = constantsJson.scoreRange.MAX_SCORE;

/** Bounds of the single byte the score is encoded as, which is wider. */
export const ENCODED_SCORE_RANGE = {
  MIN: constantsJson.scoreRange.encodedRange.MIN,
  MAX: constantsJson.scoreRange.encodedRange.MAX,
  lengthBytes: constantsJson.scoreRange.encodedRange.lengthBytes,
} as const;

/**
 * Byte lengths of the protocol's fixed-width fields, exactly as the protocol
 * declares them.
 *
 * The unit is bytes, not hex characters. A fact renders these fields as hex, so
 * the hex length is twice this, and confusing the two is easy and silent: a
 * consumer validating `ownerPkh` against 20 characters would reject every valid
 * fact and, worse, accept a 10-character prefix of one. Use
 * {@link FIELD_HEX_LENGTHS} when checking a rendered fact.
 */
export const FIELD_BYTE_LENGTHS = {
  PKH: constantsJson.fieldLengths.PKH,
  TXID: constantsJson.fieldLengths.TXID,
  CATEGORY: constantsJson.fieldLengths.CATEGORY,
  SCORE: constantsJson.fieldLengths.SCORE,
} as const;

/**
 * The same lengths in hex characters, which is how they appear in a fact.
 *
 * Derived rather than declared so the two can never disagree.
 */
export const FIELD_HEX_LENGTHS = {
  PKH: constantsJson.fieldLengths.PKH * 2,
  TXID: constantsJson.fieldLengths.TXID * 2,
  CATEGORY: constantsJson.fieldLengths.CATEGORY * 2,
  SCORE: constantsJson.fieldLengths.SCORE * 2,
} as const;

/**
 * The eight fact types of the protocol.
 *
 * Declared here as well as read from the protocol file so the two can be
 * cross-checked instead of trusted. If the protocol ever adds a fact type and
 * this SDK is not updated, the mismatch throws at load time. That is the
 * behaviour worth having: a recognizer that silently does not implement a fact
 * type reports a chain as ordinary non-RepID traffic, and the omission is
 * invisible until someone goes looking for that transaction by hand.
 */
const KNOWN_FACT_TYPES = [
  'IDENTITY_GENESIS',
  'IDENTITY_COLLATERAL_TOP_UP',
  'IDENTITY_BURNED',
  'RECEIPT_GENESIS',
  'RATING_ISSUED',
  'RATING_RETRACTION',
  'PLATFORM_CONFIRMATION',
  'TRUST_LINK',
] as const satisfies readonly FactType[];

const declaredByProtocol: string[] = constantsJson.factTypes.map(
  (entry: { type: string }) => entry.type,
);
const knownSet = new Set<string>(KNOWN_FACT_TYPES);
const unrecognised = declaredByProtocol.filter((type) => !knownSet.has(type));
const unimplemented = KNOWN_FACT_TYPES.filter((type) => !declaredByProtocol.includes(type));

if (unrecognised.length > 0 || unimplemented.length > 0) {
  const parts = [
    unrecognised.length > 0
      ? `the protocol declares fact types this SDK does not implement: ${unrecognised.join(', ')}`
      : '',
    unimplemented.length > 0
      ? `this SDK implements fact types the protocol no longer declares: ${unimplemented.join(', ')}`
      : '',
  ].filter(Boolean);
  throw new Error(
    `RepID fact type mismatch between protocol ${PROTOCOL_NAME} and @repid/sdk. ${parts.join('; ')}. ` +
      'Run npm run sync:protocol and update the SDK before releasing.',
  );
}

export const FACT_TYPES: readonly FactType[] = KNOWN_FACT_TYPES;

/** True when `value` is one of the eight protocol fact types. */
export function isFactType(value: string): value is FactType {
  return (FACT_TYPES as readonly string[]).includes(value);
}
