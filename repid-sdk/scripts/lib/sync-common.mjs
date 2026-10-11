// Shared definition of where the SDK gets its normative inputs from.
//
// The SDK must not hand-copy the protocol's constants and schema: a second
// definition is a second truth, and the whole point of separating the protocol
// was to have exactly one. So the files are copied from the protocol repository
// and their hashes are recorded, which lets `check-drift` prove the copy still
// matches the original instead of trusting that nobody forgot to re-sync.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// This file lives at <sdk>/scripts/lib/, so the SDK root is two levels up.
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SDK_ROOT = path.resolve(HERE, '..', '..');
// The sync manifest lives at the repository root, not under src/. It is
// repository bookkeeping, not source: keeping it out of the compiled tree means
// the compiler never copies it into dist/ and it can never end up inside the
// published tarball, where it would have no meaning and could carry a path from
// whoever last ran the sync.
export const MANIFEST_PATH = path.join(SDK_ROOT, 'SOURCE.json');

/**
 * The normative files the SDK embeds, plus the covenant artifacts its tests
 * build transactions against.
 *
 * `scope: 'src'` files are part of the published package: the SDK genuinely
 * needs the constants and the schema at runtime. `scope: 'test'` files are
 * test-only -- the artifacts are the *input* for building transactions, not
 * something a consumer of the SDK needs, so they are kept out of the published
 * `files` list. Both come from the same repository, so there is still one copy
 * of each artifact in the world.
 */
export const SYNCED_FILES = [
  {
    source: 'protocol/constants.json',
    dest: 'src/protocol/constants.json',
    scope: 'src',
    label: 'protocol constants',
  },
  {
    source: 'protocol/schemas/repid-fact.schema.json',
    dest: 'src/protocol/schemas/repid-fact.schema.json',
    scope: 'src',
    label: 'fact JSON Schema',
  },
  {
    source: 'protocol/protocol-version.json',
    dest: 'src/protocol/protocol-version.json',
    scope: 'src',
    label: 'protocol version',
  },
  {
    // The requirement inventory is test-only. A consumer of the SDK never needs
    // to know which requirements the protocol declares, but the traceability
    // test needs the exact list to check itself against, and that list must come
    // from the specifications rather than from a hand-kept copy here: a second
    // copy is a second truth, which is the reason this file exists.
    source: 'protocol/requirements.json',
    dest: 'test/fixtures/requirements.json',
    scope: 'test',
    label: 'requirement inventory',
  },
  {
    source: 'artifacts/identity_genesis.json',
    dest: 'test/fixtures/identity_genesis.json',
    scope: 'test',
    label: 'identity genesis artifact',
  },
  {
    source: 'artifacts/identity_vault.json',
    dest: 'test/fixtures/identity_vault.json',
    scope: 'test',
    label: 'identity vault artifact',
  },
  {
    source: 'artifacts/receipt_genesis.json',
    dest: 'test/fixtures/receipt_genesis.json',
    scope: 'test',
label: 'receipt genesis artifact',
    },
    {
      // RatingRightVault. The receipt genesis cannot name this covenant, so the
      // tests have to instantiate it themselves to produce a transaction that
      // locks a Rating Right under it (SPEC-008 RF-O822).
      source: 'artifacts/rating_right.json',
      dest: 'test/fixtures/rating_right.json',
      scope: 'test',
      label: 'rating right artifact',
    },
  {
    // The canonical covenant bytecode, in hex. The artifacts above cannot serve
    // this purpose: their `bytecode` field holds disassembled mnemonics, which
    // are not comparable to anything on chain.
    //
    // This one is `scope: 'src'` rather than `scope: 'test'` because the SDK's
    // binding verification (SPEC-009 section 12) needs it at runtime: to verify a
    // fact came from a covenant it must reconstruct the expected script, and the
    // bytes to reconstruct it from are the compiler's output, which a recognizer
    // cannot derive from the chain. A consumer that enables binding therefore
    // needs the bytecode shipped in the package, and the compiler version it was
    // produced with, because a different compiler emits different bytes.
    source: 'protocol/covenant-bytecode.json',
    dest: 'src/protocol/covenant-bytecode.json',
    scope: 'src',
    label: 'canonical covenant bytecode',
  },
  {
    // The raw transactions of the real Chipnet run. The protocol repository also
    // records the facts it concluded about them, but a conclusion is not
    // evidence: the recognizer has to be able to re-derive them from the bytes
    // to prove it reaches the same conclusion. Kept as one document so the txid
    // and the hex cannot be separated.
    source: 'conformance/fixtures/real-chain-txs.json',
    dest: 'test/fixtures/real-chain-txs.json',
    scope: 'test',
    label: 'real Chipnet transactions',
  },
];

/**
 * Resolves the protocol repository. Defaults to the sibling checkout, which is
 * how the three repositories sit on a contributor's machine; overridable so CI
 * and anyone with a different layout can point at it.
 */
export function resolveProtocolRepo() {
  const fromEnv = process.env.REPID_PROTOCOL_REPO;
  if (fromEnv) return path.resolve(fromEnv);
  return path.resolve(SDK_ROOT, '..', 'repid-protocol');
}

export function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

export function readManifest() {
  if (!existsSync(MANIFEST_PATH)) return null;
  try {
    return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  } catch (err) {
    return { error: `SOURCE.json is unreadable: ${err.message}` };
  }
}

export function writeManifest(manifest) {
  mkdirSync(path.dirname(MANIFEST_PATH), { recursive: true });
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

/** Reads one synced file from the protocol repository, or null if absent. */
export function readSourceFile(protocolRepo, relSource) {
  const absolute = path.join(protocolRepo, relSource);
  if (!existsSync(absolute)) return null;
  return readFileSync(absolute);
}

/** Reads the SDK's copy of a synced file, or null if absent. */
export function readDestFile(relDest) {
  const absolute = path.join(SDK_ROOT, relDest);
  if (!existsSync(absolute)) return null;
  return readFileSync(absolute);
}
