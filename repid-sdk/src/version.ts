// What this build is, and which protocol versions it is willing to speak.
//
// SPEC-010 requires an implementation to declare the set of protocol versions it
// implements, and forbids it from claiming a version it has not been verified
// against. This module is that declaration, and it is deliberately hand-written
// rather than derived from the bundled protocol file.
//
// Deriving the supported set from the file would make the check vacuous: the file
// arrives from `npm run sync:protocol`, so it always says whatever the protocol
// repository currently says, and a "supported" set built from it would agree with
// itself by construction. The point of declaring a version is to have something
// that can disagree with the file, so a protocol bump that nobody has reviewed
// here stops the build instead of passing silently.

import { PROTOCOL_NAME, PROTOCOL_VERSION } from './constants.js';

/**
 * The SDK's own version, which follows its own semver and is not required to
 * track the protocol version numerically (SPEC-010 §8).
 *
 * Written literally rather than read from `package.json`, because a runtime
 * import of a file outside `src/` fights the build's rootDir. A literal can
 * drift, so `test/sdk_version.test.ts` asserts it equals `package.json` — the
 * check the runtime cannot make becomes the check the test makes.
 */
export const SDK_VERSION = '0.1.0';

/**
 * The protocol versions this build implements, as stated by SPEC-010 §5.
 *
 * Since task E the declared set was `0.3.0` and `0.4.0`, and this is the case
 * SPEC-010 §4.1 calls a *superset, not a replacement*. `0.4.0` changes no rule
 * that reads a `0.3.0` byte: it adds the identity-vault burn-delay body, the
 * `REPID_RATING2` comment hash, the `REPID_RETRACT1` retraction and the optional
 * interaction context in the Receipt's NFT commitment. The same bytes that
 * produced a fact under `0.3.0` produce the same fact under `0.4.0`, so one
 * recognizer reads both eras identically and can honestly claim both versions.
 *
 * `0.5.0` is the same kind of superset over `0.4.0`, added deliberately in this
 * batch. Its only normative change is the *publisher-facing* layout of the
 * `commentHash` preimage, which binds the utterance to its Receipt by hashing
 * that Receipt's `receiptCategory` (SPEC-009 §4.2, SPEC-004 RF-10), and the
 * permanent removal of any published preimage for the interaction `contextHash`
 * (SPEC-004 RF-12). None of that changes a single byte this recognizer reads:
 * `commentHash` and `contextHash` are reported opaquely, exactly as spent, and
 * the Receipt's NFT commitment keeps the `0x10`/`0x11` forms. The identity
 * vault body is also unchanged, so the protocol registry records the `0.4.0`
 * body under `0.5.0` — this build binds a `0.5.0` deployment against those same
 * bytes by declared set, never by trial matching.
 *
 * That is why the versions here stop at a deliberate boundary. `0.1.0` and
 * `0.2.0` are *not* addable the same way: at `0.2.0` a receipt genesis whose
 * Rating Rights were in P2PKH was recognized, and since `0.3.0` it is not
 * (SPEC-009 RF-W58). The same bytes must produce different facts under those
 * versions, and only one of them is what this code does; claiming them would be
 * claiming a reading this recognizer does not perform.
 *
 * The set is also load-bearing for covenant binding. The identity vault is the
 * one covenant with two coexisting bodies (the pre-`0.4.0` one, no burn delay,
 * and the `0.4.0` one with `require(this.age >= 144)`), and SPEC-009 RF-W56/
 * RF-W76 requires an implementation to bind against the bodies of its *declared*
 * versions and never by trial matching — see `src/recognize.ts`, which derives
 * the accepted bodies from this list.
 */
export const SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = ['0.3.0', '0.4.0', '0.5.0'];

/**
 * Fails loudly when a protocol version is not one this build implements.
 *
 * "Loudly" means throwing, not warning and not degrading. An indexer that
 * continues under rules it does not implement produces facts that are wrong in
 * ways nothing downstream can detect, because a malformed fact and a
 * misinterpreted one are indistinguishable to whoever audits the result.
 */
export function assertSupportsProtocolVersion(version: string): void {
  if (!SUPPORTED_PROTOCOL_VERSIONS.includes(version)) {
    throw new Error(
      `@repid/sdk ${SDK_VERSION} does not implement ${PROTOCOL_NAME} protocol version ${version}. ` +
        `Supported: ${SUPPORTED_PROTOCOL_VERSIONS.join(', ')}. ` +
        'Do not claim a protocol version this build has not been verified against (SPEC-010 §5).',
    );
  }
}

/**
 * The version this build actually operates under, and it must be one it claims.
 *
 * This runs at load time on purpose. `PROTOCOL_VERSION` is read from the copy of
 * `protocol/protocol-version.json` that `sync-protocol.mjs` pulled out of the
 * protocol repository, so it changes when *that* repository is updated, not when
 * this one is. If a sync brings in a version this build never reviewed, the
 * recognizer refuses to load rather than reading transactions under rules
 * nothing here was written against.
 */
assertSupportsProtocolVersion(PROTOCOL_VERSION);
