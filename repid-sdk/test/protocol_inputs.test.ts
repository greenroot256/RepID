// The protocol inputs the SDK reads at load time.
//
// These assertions exist because the failure they guard against is silent. A
// constant that is wrong, or a version that stops being reported, produces a
// recognizer that keeps working and quietly disagrees with the protocol. Nothing
// else in the suite would notice.

import { describe, it, expect } from 'vitest';
import constantsJson from '../src/protocol/constants.json' with { type: 'json' };
import protocolVersionJson from '../src/protocol/protocol-version.json' with { type: 'json' };
import {
  ENCODED_SCORE_RANGE,
  FACT_TYPES,
  FIELD_BYTE_LENGTHS,
  FIELD_HEX_LENGTHS,
  MAX_SCORE,
  MIN_SCORE,
  OP_RETURN_TAGS,
  PROTOCOL_NAME,
  PROTOCOL_SPECIFICATION,
  PROTOCOL_STATUS,
  PROTOCOL_VERSION,
  isFactType,
} from '../src/index.js';

describe('protocol inputs', () => {
  it('reports the protocol version and its status, not just the number', () => {
    // SPEC-010 requires the pre-release status to be visible. Publishing the
    // number alone would let a consumer read 0.1.0 as "stable".
    expect(PROTOCOL_VERSION).toBe(protocolVersionJson.version);
    expect(PROTOCOL_STATUS).toBe('pre-release');
    expect(PROTOCOL_NAME).toBe(protocolVersionJson.protocol);
    expect(PROTOCOL_SPECIFICATION.length).toBeGreaterThan(0);
  });

  it('exposes the eight fact types the protocol declares', () => {
    expect(FACT_TYPES).toHaveLength(8);
    expect(constantsJson.factTypes.map((f: { type: string }) => f.type)).toEqual([...FACT_TYPES]);
    for (const type of FACT_TYPES) expect(isFactType(type)).toBe(true);
    expect(isFactType('NOT_A_FACT')).toBe(false);
  });

  it('keeps the valid score range inside the range the score is encoded in', () => {
    // A valid score outside the encodable byte range would be a rating no
    // transaction could ever express, which would make the valid range fiction.
    expect(MIN_SCORE).toBeGreaterThanOrEqual(ENCODED_SCORE_RANGE.MIN);
    expect(MAX_SCORE).toBeLessThanOrEqual(ENCODED_SCORE_RANGE.MAX);
    expect(MAX_SCORE - MIN_SCORE + 1).toBe(5);
  });

  it('uses OP_RETURN tags that are ASCII and fit in a single push', () => {
    // A tag is pushed as data, not executed as an opcode, so the property that
    // matters is that it is plain ASCII and short enough for one PUSH1..PUSH75.
    // A tag needing OP_PUSHDATA1 would still work but would no longer be the
    // "push-only" marker the specification describes.
    for (const [name, entry] of Object.entries(constantsJson.opReturnTags)) {
      const value = (entry as { value: string }).value;
      expect(Buffer.from(value, 'ascii').toString('ascii'), `${name} is ASCII`).toBe(value);
      expect(value.length, `${name} lengthBytes matches the value`).toBe(
        (entry as { lengthBytes: number }).lengthBytes,
      );
      expect(value.length, `${name} fits in one push`).toBeLessThanOrEqual(75);
    }
    expect(OP_RETURN_TAGS.RATING).toBe(constantsJson.opReturnTags.RATING.value);
  });

  it('reports field lengths in bytes and derives the hex lengths from them', () => {
    // The protocol states byte lengths, while a fact renders hex. Both are
    // exposed because the two are easy to mix up, and the hex lengths are
    // derived so they cannot drift from the byte lengths.
    expect(FIELD_BYTE_LENGTHS.PKH).toBe(constantsJson.fieldLengths.PKH);
    expect(FIELD_HEX_LENGTHS.PKH).toBe(FIELD_BYTE_LENGTHS.PKH * 2);
    expect(FIELD_HEX_LENGTHS.TXID).toBe(FIELD_BYTE_LENGTHS.TXID * 2);
    expect(FIELD_HEX_LENGTHS.CATEGORY).toBe(FIELD_BYTE_LENGTHS.CATEGORY * 2);
    expect(FIELD_HEX_LENGTHS.SCORE).toBe(FIELD_BYTE_LENGTHS.SCORE * 2);

    // A pkh is a 20-byte hash160, and a txid a 32-byte double SHA-256. These are
    // not arbitrary: a field with a different width could not be the value the
    // specification means, whatever the file happens to say.
    expect(FIELD_BYTE_LENGTHS.PKH).toBe(20);
    expect(FIELD_BYTE_LENGTHS.TXID).toBe(32);
    expect(FIELD_BYTE_LENGTHS.SCORE).toBe(1);
  });
});
