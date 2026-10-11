// SPEC-010 §5: declaring which protocol versions an implementation implements.
//
// The requirement is small and easy to satisfy performatively, by exporting a
// list copied from whatever the protocol repository currently says. That version
// of it is worthless: the list would agree with the bundled file by
// construction, so no change could ever be caught. The tests below are written
// against the property that makes the declaration mean something — an
// unreviewed version must be rejected.

import { describe, it, expect } from 'vitest';
import packageJson from '../package.json' with { type: 'json' };
import {
  PROTOCOL_NAME,
  PROTOCOL_VERSION,
  SDK_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
  assertSupportsProtocolVersion,
} from '../src/index.js';

describe('implemented version declaration (SPEC-010 section 5)', () => {
  it('keeps SDK_VERSION equal to the published package version', () => {
    // The constant is a literal so it can be compared against the bundled
    // protocol file without a rootDir violation. That makes drift possible, so
    // the check the runtime cannot perform is performed here instead.
    expect(SDK_VERSION).toBe(packageJson.version);
  });

  it('declares the protocol version this build actually operates under', () => {
    // This is the load-time guard in src/version.ts: importing the SDK at all
    // proves the assertion passes for the bundled version. Asserting it here too
    // means a failure is reported against this test rather than surfacing as an
    // unrelated import error somewhere else in the suite.
    expect(SUPPORTED_PROTOCOL_VERSIONS).toContain(PROTOCOL_VERSION);
  });

  it('accepts a supported version and rejects one it does not implement', () => {
    expect(() => assertSupportsProtocolVersion(PROTOCOL_VERSION)).not.toThrow();
    expect(() => assertSupportsProtocolVersion('9.9.9')).toThrow();
  });

  it('rejects a version that is merely plausible', () => {
    // The case a copied list would fail: 0.6.0 looks like the successor of the
    // 0.5.0 this build claims, and a sync would bring it in silently. It has to
    // be refused until someone adds it deliberately.
    expect(SUPPORTED_PROTOCOL_VERSIONS).not.toContain('0.6.0');
    expect(() => assertSupportsProtocolVersion('0.6.0')).toThrow();
  });

  it('declares the 0.3.0/0.4.0/0.5.0 superset it reads under', () => {
    // Task E made 0.4.0 a superset of 0.3.0 rather than a replacement (SPEC-010
    // section 4.1): it adds the vault burn-delay body, REPID_RATING2, REPID_RETRACT1
    // and the receipt interaction context, and changes no rule that reads a
    // 0.3.0 byte. The 0.5.0 batch is the same kind of superset over 0.4.0: its
    // only normative change is the publisher-facing commentHash preimage (now
    // bound to the Receipt's category, SPEC-009 section 4.2) and the removal of
    // the contextHash preimage; the recognizer reads both hashes opaquely, so
    // every byte it recognizes under 0.4.0 is recognized the same way under
    // 0.5.0, and the vault body is unchanged. One recognizer reads all three
    // eras identically, so it claims all three.
    expect(SUPPORTED_PROTOCOL_VERSIONS).toContain('0.4.0');
    expect(SUPPORTED_PROTOCOL_VERSIONS).toContain('0.3.0');
    expect(SUPPORTED_PROTOCOL_VERSIONS).toContain('0.5.0');
    expect(() => assertSupportsProtocolVersion('0.4.0')).not.toThrow();
    expect(() => assertSupportsProtocolVersion('0.5.0')).not.toThrow();
  });

  it('does not claim 0.1.0 or 0.2.0, whose rules it no longer implements', () => {
    // The pre-1.0 case in SPEC-010 section 4.1, and the reason it is not the same
    // as a MAJOR boundary. At 0.3.0 a receipt genesis with its Rating Rights in
    // P2PKH is not recognized (RF-W58); at 0.2.0 it was, and at 0.1.0 a receipt
    // naming one party as both of them was recognized too. The same bytes must
    // produce different facts under those versions, so listing any of them would
    // be claiming a reading this code does not perform.
    expect(SUPPORTED_PROTOCOL_VERSIONS).not.toContain('0.1.0');
    expect(SUPPORTED_PROTOCOL_VERSIONS).not.toContain('0.2.0');
    expect(() => assertSupportsProtocolVersion('0.1.0')).toThrow();
    expect(() => assertSupportsProtocolVersion('0.2.0')).toThrow();
  });

  it('names the requested and the supported versions when it refuses', () => {
    // A failure a reader cannot act on is a failure that gets worked around.
    let message = '';
    try {
      assertSupportsProtocolVersion('0.6.0');
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('0.6.0');
    expect(message).toContain(PROTOCOL_VERSION);
    expect(message).toContain(PROTOCOL_NAME);
    expect(message).toContain(SDK_VERSION);
  });

  it('declares a pre-release protocol version rather than a stable one', () => {
    // Not a SPEC-010 section 5 requirement, but the two are published together
    // and a supported-set entry without the status is how 0.1.0 gets read as
    // "stable". PROTOCOL_STATUS carries it; this pins the pairing.
    expect(PROTOCOL_VERSION.startsWith('0.')).toBe(true);
  });
});
