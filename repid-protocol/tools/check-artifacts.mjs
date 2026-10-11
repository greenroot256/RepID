// Verifies that each contract source in contracts/ compiles to the bytecode
// recorded in protocol/constants.json.
//
// A covenant is a protocol artifact: if the source and the recorded fingerprint
// disagree, one of them is wrong and every implementation that trusts the
// fingerprint is affected. This check is the guard for that.
//
// If the compiler is unavailable the check reports SKIPPED, never PASS. A
// missing toolchain is not evidence of a correct artifact.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const constants = JSON.parse(
  readFileSync(join(root, 'protocol', 'constants.json'), 'utf8'),
);

// On Windows the npm-generated shims are .cmd files, which cannot be spawned
// directly: they need a command interpreter. Resolve that once, here.
function spawnable(cmd, args) {
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(cmd)) {
    return { cmd: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', cmd, ...args] };
  }
  return { cmd, args: [...args] };
}

function run(cmd, args) {
  const { cmd: c, args: a } = spawnable(cmd, args);
  return execFileSync(c, a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function findCashc() {
  if (process.env.CASHC) return process.env.CASHC;
  const local = join(root, 'node_modules', '.bin', 'cashc');
  if (existsSync(local)) return process.platform === 'win32' ? `${local}.cmd` : local;
  for (const name of ['cashc', 'cashc.cmd']) {
    try {
      run(name, ['--version']);
      return name;
    } catch { /* keep looking */ }
  }
  return null;
}

const cashc = findCashc();
const expectedCompiler = constants.contracts.compiler;

if (!cashc) {
  console.log('SKIPPED: cashc not found.');
  console.log('  The contract artifacts were NOT verified in this run.');
  console.log('  Set CASHC, or install cashscript, to run this check.');
  process.exit(2);
}

let version;
try {
  version = run(cashc, ['--version']).trim();
} catch (error) {
  console.log(`SKIPPED: could not run cashc (${error.message}).`);
  process.exit(2);
}

if (!version.includes(expectedCompiler.version)) {
  console.log(`FAILED: compiler version drift.`);
  console.log(`  recorded in constants.json : cashc ${expectedCompiler.version}`);
  console.log(`  found in this environment  : ${version}`);
  console.log(`  A different compiler can produce different bytecode. Re-verify before changing the recorded fingerprint.`);
  process.exit(1);
}

const work = mkdtempSync(join(tmpdir(), 'repid-artifacts-'));
let failures = 0;

function verifyArtifact(name, contract) {
  const sourcePath = join(root, contract.source);
  const artifactPath = join(root, contract.artifact);
  if (!existsSync(sourcePath)) {
    console.log(`FAILED  ${name}: missing source ${contract.source}`);
    failures += 1;
    return;
  }

  const outPath = join(work, `${name}.json`);
  try {
    run(cashc, [sourcePath, '--output', outPath]);
  } catch (error) {
    console.log(`FAILED  ${name}: compilation failed`);
    console.log(`        ${(error.stdout || '').toString().trim() || error.message}`);
    failures += 1;
    return;
  }

  const compiled = JSON.parse(readFileSync(outPath, 'utf8'));
  const committed = JSON.parse(readFileSync(artifactPath, 'utf8'));

  // NOTE: the artifact's `bytecode` field holds the *disassembled* CashScript
  // mnemonics, not hex. The compiled bytes are not published in the artifact,
  // so the fingerprint cannot be re-derived here; it is taken from cashc,
  // which computes it from the real script. What we can verify independently
  // is that a fresh compile reproduces the committed mnemonic bytecode, ABI,
  // embedded source and compiler-reported fingerprint.
  const problems = [];
  if (compiled.fingerprint !== contract.fingerprint) {
    problems.push('fresh compile fingerprint differs from constants.json');
  }
  if (committed.fingerprint !== contract.fingerprint) {
    problems.push('committed artifact self-reported fingerprint differs from constants.json');
  }
  if (compiled.bytecode !== committed.bytecode) {
    problems.push('compiled bytecode differs from the committed artifact');
  }
  if (JSON.stringify(compiled.abi) !== JSON.stringify(committed.abi)) {
    problems.push('ABI differs from the committed artifact');
  }
  if (compiled.source !== committed.source) {
    problems.push('embedded source differs from the committed artifact');
  }
  if (compiled.debug?.bytecode !== committed.debug?.bytecode) {
    problems.push('debug bytecode differs from the committed artifact');
  }
  if (compiled.contractName !== committed.contractName) {
    problems.push('contract name differs from the committed artifact');
  }

  if (problems.length > 0) {
    console.log(`FAILED  ${name}`);
    for (const problem of problems) console.log(`          - ${problem}`);
    console.log(`          fresh compile : ${compiled.fingerprint}`);
    console.log(`          recorded      : ${contract.fingerprint}`);
    failures += 1;
  } else {
    console.log(`ok      ${name}  ${contract.fingerprint.slice(0, 16)}...`);
  }
}

try {
  for (const [name, contract] of Object.entries(constants.contracts)) {
    if (name === 'compiler' || name.startsWith('$')) continue; // metadata, not a contract

    // Versioned covenant: identityVault. Every declared version is verified
    // against its own source/artifact pair (SPEC-009 RF-W56/RF-W76: the declared
    // set, not a single flat body).
    if ('versions' in contract) {
      for (const version of Object.keys(contract.versions)) {
        verifyArtifact(`${name} ${version}`, contract.versions[version]);
      }
      continue;
    }

    verifyArtifact(name, contract);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (failures > 0) {
  console.log(`\n${failures} artifact(s) do not match.`);
  process.exit(1);
}
console.log('\nAll contract artifacts reproduce exactly.');
