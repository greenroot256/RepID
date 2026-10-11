/**
 * The Bitcoin Cash dust rule, reimplemented.
 *
 * cashscript enforces dust too, but only by throwing when a build produces an
 * output below the floor. Anything that has to compute a change amount *before*
 * building — which is every transaction here, because the escrow amount is
 * fixed and the surplus has to be returned to the client — needs the exact
 * minimum, and cashscript 0.13.3 does not export one (`calculateDust` lives in
 * an unpublished internal path). So the rule lives here instead.
 *
 * `444 + outputSize * 3`, where outputSize is 8 (value) + 1 (script varint) +
 * script length. A script carrying a CashToken adds a prefix of 1 (capability)
 * + 32 (category) + 1 (commitment varint) + commitment + 1 (amount flag).
 *
 * Both constants below are pinned by `test:repid` against amounts observed in
 * the RepID reference's real Chipnet transactions: 546 sats for a plain P2PKH
 * output and 741 for a P2SH32 output carrying the identity NFT.
 */

/** Standard P2PKH: OP_DUP OP_HASH160 <20> OP_EQUALVERIFY OP_CHECKSIG. */
export const P2PKH_SCRIPT_LEN = 25;

/** P2SH32: OP_HASH160 <32> OP_EQUAL, as used for CashScript covenant addresses. */
export const P2SH32_SCRIPT_LEN = 35;

export function dustAmount(lockingScriptLen: number, commitmentHex?: string): bigint {
  const tokenPrefixLen = commitmentHex === undefined ? 0 : 1 + 32 + 1 + commitmentHex.length / 2 + 1;
  const outputSize = 8 + 1 + lockingScriptLen + tokenPrefixLen;
  return BigInt(444 + outputSize * 3);
}

/** Dust floor for a P2PKH output, optionally carrying an immutable NFT. */
export function p2pkhDust(commitmentHex?: string): bigint {
  return dustAmount(P2PKH_SCRIPT_LEN, commitmentHex);
}
