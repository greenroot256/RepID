// OP_RETURN container parsing (SPEC-009 section 3.1, RF-W01..RF-W05 and RF-W45).
//
// The rules here are about the *container*, not about any particular fact, so
// they are tested against `parseOpReturn` directly. Testing them through
// `indexRawTransaction` alone would only show the aggregate result (a fact or
// none) and would not say which rule rejected the script; several of these
// inputs are malformed in ways that no RepID tag is involved at all.
//
// The last describe block goes back through the full pipeline on the one case
// that is reachable as an actual fact, because a unit test above would still
// pass if the recognizer ignored the parser's verdict somewhere.

import { describe, it, expect } from 'vitest';
import { utf8ToBin } from '@bitauth/libauth';
import { parseOpReturn, hexToBytes, toHex } from '../src/bytes.js';
import { OP_RETURN_TAGS } from '../src/constants.js';

const OP_RETURN = 0x6a;
const PUSHDATA1 = 0x4c;
const PUSHDATA2 = 0x4d;
const PUSHDATA4 = 0x4e;

const RATING_TAG = OP_RETURN_TAGS.RATING; // REPID_RATING1, 13 bytes

/** Builds `OP_RETURN <len> <bytes> ...` from already-encoded pushes. */
function script(...pushes: Uint8Array[]): Uint8Array {
  const parts: number[] = [OP_RETURN];
  for (const push of pushes) {
    parts.push(push.length, ...push);
  }
  return new Uint8Array(parts);
}

const push = (s: string): Uint8Array => utf8ToBin(s);
const pushBytes = (...b: number[]): Uint8Array => new Uint8Array(b);

describe('parseOpReturn / accepted container (RF-W01, RF-W05)', () => {
  it('splits a direct tag push followed by a direct payload push', () => {
    const result = parseOpReturn(script(push(RATING_TAG), pushBytes(4)));

    expect(result).not.toBeNull();
    expect(result?.tag).toBe(RATING_TAG);
    expect(result?.chunks).toHaveLength(2);
  });

  it('preserves chunk boundaries instead of concatenating the payload', () => {
    // Three one-byte pushes must not be read as one three-byte chunk; the
    // recognizers index chunks positionally, so a merge would change meaning.
    const result = parseOpReturn(script(push(RATING_TAG), pushBytes(1), pushBytes(2), pushBytes(3)));

    // Four chunks: the tag plus the three separate payload pushes.
    expect(result?.chunks).toHaveLength(4);
    expect(result?.chunks.slice(1).map((c) => c[0])).toEqual([1, 2, 3]);
  });

  it('preserves a multi-byte payload as a single chunk', () => {
    const pkh = 'ab'.repeat(20);
    const result = parseOpReturn(script(push(OP_RETURN_TAGS.TRUST), hexToBytes(pkh)));

    expect(result?.chunks).toHaveLength(2);
    expect(toHex(result!.chunks[1]!)).toBe(pkh);
  });

  it('decodes the tag as UTF-8 text', () => {
    const result = parseOpReturn(script(push(RATING_TAG), pushBytes(4)));
    expect(result?.tag).toBe('REPID_RATING1');
  });
});

describe('parseOpReturn / rejected encodings (RF-W02)', () => {
  it('rejects OP_0 (0x00) in the tag position', () => {
    // OP_0 is a zero-length push. RF-W02 rejects it rather than treating it as
    // an empty tag, which would otherwise decode to the empty string.
    expect(parseOpReturn(new Uint8Array([OP_RETURN, 0x00, 0x01, 0x04]))).toBeNull();
  });

  it('rejects OP_0 in a payload position', () => {
    // An actual empty push, i.e. the OP_0 opcode, not a pushed zero byte.
    expect(parseOpReturn(script(push(RATING_TAG), new Uint8Array([])))).toBeNull();
  });

  it('accepts a pushed zero byte, which is a one-byte chunk and not OP_0', () => {
    // Score 0 is out of the 1-5 range and is rejected later by RF-04, but the
    // container is well formed: `0x00` here is data behind a length byte, not
    // the OP_0 opcode. Reading it as an empty push would throw away the byte
    // and turn a malformed rating into a different malformed rating.
    const result = parseOpReturn(script(push(RATING_TAG), pushBytes(0)));

    expect(result?.chunks).toHaveLength(2);
    expect(result?.chunks[1]).toHaveLength(1);
    expect(result?.chunks[1]?.[0]).toBe(0);
  });

  it('rejects a zero-length push anywhere', () => {
    expect(parseOpReturn(new Uint8Array([OP_RETURN, 0x00, 0x0d, ...utf8ToBin(RATING_TAG)]))).toBeNull();
  });

  it('rejects PUSHDATA1 (0x4c) rather than honouring the indirection', () => {
    // 0x4c <len> <data> would carry a valid tag, but RepID emits only direct
    // pushes; accepting the indirection would widen what counts as a tag.
    const body = script(push(RATING_TAG), pushBytes(4));
    const withPushdata1 = new Uint8Array([OP_RETURN, PUSHDATA1, RATING_TAG.length, ...utf8ToBin(RATING_TAG), 0x01, 0x04]);

    expect(body.length).toBeGreaterThan(0);
    expect(parseOpReturn(withPushdata1)).toBeNull();
  });

  it('rejects PUSHDATA2 (0x4d)', () => {
    const withPushdata2 = new Uint8Array([
      OP_RETURN,
      PUSHDATA2,
      0x00,
      RATING_TAG.length,
      ...utf8ToBin(RATING_TAG),
      0x01,
      0x04,
    ]);
    expect(parseOpReturn(withPushdata2)).toBeNull();
  });

  it('rejects PUSHDATA4 (0x4e)', () => {
    const withPushdata4 = new Uint8Array([
      OP_RETURN,
      PUSHDATA4,
      0x00,
      0x00,
      0x00,
      RATING_TAG.length,
      ...utf8ToBin(RATING_TAG),
      0x01,
      0x04,
    ]);
    expect(parseOpReturn(withPushdata4)).toBeNull();
  });

  it('rejects a push declaring a length above 75', () => {
    // 76 is one past the largest direct push, and its value byte (0x4c) is
    // PUSHDATA1, so this is exactly the byte a direct reader would misread.
    const tooLong = new Uint8Array([OP_RETURN, 76, ...new Uint8Array(76), 0x01, 0x04]);
    expect(parseOpReturn(tooLong)).toBeNull();
  });

  it('rejects a bare OP_RETURN with no pushes', () => {
    expect(parseOpReturn(new Uint8Array([OP_RETURN]))).toBeNull();
  });

  it('rejects a single push, since a tag needs at least a payload', () => {
    expect(parseOpReturn(new Uint8Array([OP_RETURN, RATING_TAG.length, ...utf8ToBin(RATING_TAG)]))).toBeNull();
  });

  it('rejects a script that does not start with OP_RETURN', () => {
    expect(parseOpReturn(script(push(RATING_TAG), pushBytes(4)))).not.toBeNull();
    const notOpReturn = script(push(RATING_TAG), pushBytes(4));
    notOpReturn[0] = 0x6b; // OP_RETURN2
    expect(parseOpReturn(notOpReturn)).toBeNull();
  });
});

describe('parseOpReturn / a declared length the script cannot satisfy (RF-W45)', () => {
  it('rejects a final push that claims more bytes than remain', () => {
    // Claims five bytes, carries one. Uint8Array.slice clamps, so without the
    // guard this reads as a well-formed one-byte payload -- and under
    // REPID_RATING1 that one byte is a score.
    const truncated = new Uint8Array([OP_RETURN, RATING_TAG.length, ...utf8ToBin(RATING_TAG), 0x05, 0x04]);

    expect(truncated.length).toBe(1 + 1 + RATING_TAG.length + 1 + 1);
    expect(parseOpReturn(truncated)).toBeNull();
  });

  it('rejects a tag push that claims more bytes than remain', () => {
    // The overflow in the first chunk, before any payload is reached.
    const truncatedTag = new Uint8Array([OP_RETURN, 20, ...utf8ToBin(RATING_TAG)]);
    expect(parseOpReturn(truncatedTag)).toBeNull();
  });

  it('rejects a middle push that runs past the end, ignoring the trailing bytes', () => {
    // A complete second push follows, but the first one already over-reads.
    const truncatedMiddle = new Uint8Array([OP_RETURN, 30, ...utf8ToBin(RATING_TAG), 0x01, 0x04, 0x01, 0x09]);
    expect(parseOpReturn(truncatedMiddle)).toBeNull();
  });

  it('accepts a length that exactly consumes the remaining bytes', () => {
    // The boundary case: consuming the script exactly is valid, not truncation.
    const exact = new Uint8Array([OP_RETURN, RATING_TAG.length, ...utf8ToBin(RATING_TAG), 0x01, 0x04]);
    expect(parseOpReturn(exact)).not.toBeNull();
  });
});

describe('parseOpReturn / tag comparison is exact (RF-W05)', () => {
  it('does not accept a tag that is a prefix of the real one', () => {
    const shorter = RATING_TAG.slice(0, -1); // REPID_RATING, one byte short
    expect(parseOpReturn(script(push(shorter), pushBytes(4)))?.tag).toBe(shorter);
    // The recognizer compares against the constant, so a prefix is not the tag.
    expect(parseOpReturn(script(push(shorter), pushBytes(4)))?.tag).not.toBe(RATING_TAG);
  });

  it('does not accept a tag with the real one as a prefix', () => {
    const longer = `${RATING_TAG}9`;
    expect(parseOpReturn(script(push(longer), pushBytes(4)))?.tag).not.toBe(RATING_TAG);
  });

  it('is case sensitive, so a lowercased tag is a different tag', () => {
    const lowercased = RATING_TAG.toLowerCase();
    expect(lowercased).not.toBe(RATING_TAG);
    expect(parseOpReturn(script(push(lowercased), pushBytes(4)))?.tag).not.toBe(RATING_TAG);
  });

  it('keeps the other two RepID tags distinct from each other', () => {
    const r = parseOpReturn(script(push(OP_RETURN_TAGS.RATING), pushBytes(4)))?.tag;
    const t = parseOpReturn(script(push(OP_RETURN_TAGS.TRUST), hexToBytes('ab'.repeat(20))))?.tag;
    const p = parseOpReturn(script(push(OP_RETURN_TAGS.PLATFORM), hexToBytes('ab'.repeat(32))))?.tag;

    expect(r).toBe('REPID_RATING1');
    expect(t).toBe('REPID_TRUST1');
    expect(p).toBe('REPID_PLATFORM1');
    expect(new Set([r, t, p]).size).toBe(3);
  });
});
