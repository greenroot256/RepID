// Proves that src/protocol/ still matches the protocol repository.
//
// Two independent checks, because they fail for different reasons:
//
//   1. Does the SDK's copy still hash to what the manifest recorded?  This
//      catches someone hand-editing a synced file, or a bad merge.
//   2. Does the protocol repository still hash to the same thing?  This
//      catches a protocol change that was never synced.
//
// When the protocol repository is not reachable, check 1 still runs and check 2
// is reported as SKIPPED. A toolchain that is absent is not evidence of
// agreement, so this script must never print "in sync" in that case.
//
// Running without the protocol checkout is fine for a consumer who only wants
// to know the copies are intact, but it is not acceptable as a gate: a CI job
// that cannot reach the protocol would pass without ever having compared
// anything. `--strict`, or REPID_REQUIRE_PROTOCOL_SOURCE=1, turns an unreachable
// protocol into a failure. The two gates want different things, so the default
// stays permissive and the gate is explicit.

import path from 'node:path';
import {
  SYNCED_FILES,
  resolveProtocolRepo,
  readSourceFile,
  readDestFile,
  readManifest,
  sha256,
} from './lib/sync-common.mjs';

const strict =
  process.argv.includes('--strict') || process.env.REPID_REQUIRE_PROTOCOL_SOURCE === '1';

const protocolRepo = resolveProtocolRepo();
const manifest = readManifest();

if (!manifest || manifest.error || !Array.isArray(manifest.files)) {
  console.error('FATAL: SOURCE.json is missing or malformed.');
  console.error('       run: npm run sync:protocol');
  process.exit(1);
}

const bySource = new Map(manifest.files.map((f) => [f.source, f]));
let failures = 0;
let skipped = 0;

for (const { source, dest, label } of SYNCED_FILES) {
  const recorded = bySource.get(source);
  if (!recorded) {
    console.error(`FAIL    ${label.padEnd(22)} not present in SOURCE.json`);
    failures += 1;
    continue;
  }

  const destBytes = readDestFile(dest);
  if (!destBytes) {
    console.error(`FAIL    ${label.padEnd(22)} missing from the SDK (${dest})`);
    failures += 1;
    continue;
  }
  const destHash = sha256(destBytes);
  if (destHash !== recorded.sha256) {
    console.error(`FAIL    ${label.padEnd(22)} edited in the SDK (${dest})`);
    console.error(`        expected sha256 ${recorded.sha256}`);
    console.error(`        actual   sha256 ${destHash}`);
    console.error('        this file is a copy: run npm run sync:protocol');
    failures += 1;
    continue;
  }

  const sourceBytes = readSourceFile(protocolRepo, source);
  if (!sourceBytes) {
    console.warn(`SKIPPED ${label.padEnd(22)} protocol repo not reachable; copy matches manifest only`);
    skipped += 1;
    continue;
  }
  const sourceHash = sha256(sourceBytes);
  if (sourceHash !== recorded.sha256) {
    console.error(`FAIL    ${label.padEnd(22)} protocol repo has drifted (${source})`);
    console.error(`        manifest sha256 ${recorded.sha256}`);
    console.error(`        protocol  sha256 ${sourceHash}`);
    console.error('        run: npm run sync:protocol');
    failures += 1;
    continue;
  }

  console.log(`ok      ${label.padEnd(22)} ${source}`);
}

if (skipped > 0) {
  console.log(
    `\nNOTE: ${skipped} file(s) could not be compared against the protocol repository ` +
      `at ${protocolRepo}.\n      In sync with the manifest only. This is NOT a verified match.`,
  );
  if (strict) {
    console.error('FAIL    strict mode: the protocol repository must be reachable to gate on.');
    failures += skipped;
  }
}

if (failures > 0) {
  console.log(`\n${failures} file(s) out of sync with the protocol.`);
  process.exit(1);
}

if (skipped === 0) {
  console.log('\nSDK protocol inputs are in sync with the protocol repository.');
}
