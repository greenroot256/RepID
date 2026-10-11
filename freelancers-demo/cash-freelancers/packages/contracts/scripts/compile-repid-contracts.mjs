import { compileFile } from 'cashc';
import { Contract, ElectrumNetworkProvider, utils } from 'cashscript';
import { randomBytes } from 'node:crypto';

// Confirms the vendored RepID CashScript sources compile with the cashc that
// this monorepo pins (0.13.3) and instantiate to a Chipnet address. The
// reference implementation shipped prebuilt artifacts, so nothing in this
// repo would otherwise catch a compiler drift.
const provider = new ElectrumNetworkProvider('chipnet');

const cases = [
  { file: 'identity_genesis.cash', args: () => [randomBytes(20)] },
  // IdentityVault's constructor takes only ownerPkh; the collateral is a
  // `mint()` function argument, not a constructor parameter.
  { file: 'identity_vault.cash',   args: () => [randomBytes(20)] },
  { file: 'receipt_genesis.cash', args: () => [randomBytes(20), randomBytes(20)] }
];

let failed = 0;
for (const { file, args } of cases) {
  try {
    const artifact = compileFile(new URL(`../src/repid/${file}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
    const fns = artifact.abi.map(a => `${a.name}(${a.inputs.map(i => i.type).join(',')})`).join(' ');
    const c = new Contract(artifact, args(), { provider });
    console.log(`OK   ${file.padEnd(22)} [${fns}]`);
    console.log(`     -> ${c.address}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${file}: ${e.message}`);
  }
}

void utils;
process.exit(failed ? 1 : 0);
