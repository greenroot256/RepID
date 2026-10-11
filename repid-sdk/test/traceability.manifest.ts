// Which requirement each test actually proves.
//
// `constitution.md` Article 3 requires that every requirement have a real
// automated test. Until this file existed, that was an assertion nobody could
// check: the specifications declare 157 requirements, the suites cited 9
// identifiers between them, and the two numbers were never compared. Writing the
// mapping by hand would not have fixed that, because a hand-kept table drifts and
// nothing would notice. So this file is read by `traceability.test.ts`, which
// resolves every citation to a test that actually exists in the corpus and fails
// the build if one does not. The table cannot rot without the suite going red.
//
// Three rules govern what may appear here:
//
//   1. A citation names a test that exists. Not a test that should exist, and not
//      a description of one. If the assertion lives in a helper, cite the test
//      that calls it.
//   2. A requirement with no test is declared, with a reason. Silence is not
//      acceptable: an undeclared gap cannot be counted, so it cannot be closed.
//   3. A prohibition is not a test case. RF-O20 forbids on-chain value judgment.
//      No assertion can prove the absence of a class of code, so it is verified by
//      inspection and recorded as such rather than given a token test that would
//      prove nothing.

/** A requirement, the tests that prove it, and what that evidence establishes. */
export interface Covered {
  /** `file.test.ts :: exact test name`, resolved by the traceability test. */
  readonly tests: readonly string[];
  /** What the citation proves, and any limit on it. */
  readonly note: string;
}

const VAULT = 'identity_vault_indexer.test.ts';
const SHAPE = 'receipt_genesis_shape.test.ts';
const RATING = 'issued_rating_and_indexer.test.ts';
const CONSUME = 'rating_right_consumption.test.ts';
const PLATFORM = 'platform_confirmation.test.ts';
const TRUST = 'trust_link.test.ts';
  const OPCODE = 'op_return_encoding.test.ts';
const BINDING = 'covenant_binding.test.ts';
const REAL = 'real_chain_binding.test.ts';
const SEAM = 'binding_recognition.test.ts';
const B3 = 'b3_0_4_0_vectors.test.ts';

export const COVERED: Readonly<Record<string, Covered>> = {
  // --- SPEC-008 section 4.1, token structure --------------------------------
  'SPEC-008/RF-O01': {
    tests: [
      `${SHAPE} :: rejects a Receipt NFT with capability mutable`,
      `${SHAPE} :: rejects a Receipt NFT with capability minting`,
      `${SHAPE} :: rejects a mutable Rating Right even when the Receipt itself is fine`,
      `${SHAPE} :: rejects a minting Rating Right`,
      `${SHAPE} :: rejects an NFT that carries a fungible amount`,
    ],
    note:
      'capability and tokenAmount are enforced by the recognizer, and CashTokens ' +
      'independently refuses a mutable or minting NFT in a genesis. The tests ' +
      'perturb a decoded transaction, so they show the recognizer rejects the ' +
      'shape on its own; the covenant never gets the chance to agree.',
  },

  // --- SPEC-008 section 4.2, identity and collateral -----------------------
  'SPEC-008/RF-O03': {
    tests: [
      `${VAULT} :: recognizes the vault genesis and tracks the covenant outpoint with collateral and ownerPkh`,
    ],
    note:
      'the recognizer reads the vault genesis and keeps the category, the owner ' +
      'pkh and the collateral value, which is the state RF-O03 makes observable. ' +
      'That the value is strictly greater than zero is enforced by the covenant, ' +
      'not asserted here.',
  },
  'SPEC-008/RF-O05': {
    tests: [
      `${VAULT} :: marks a top-up as valid, records IDENTITY_COLLATERAL_TOP_UP and moves the tracking to the new outpoint`,
    ],
    note:
      'a top-up is only recognised as valid when the re-locked output keeps the ' +
      'category and the commitment and does not reduce the value, so the ' +
      'monotonicity the requirement states is what makes the test pass.',
  },
  'SPEC-008/RF-O06': {
    tests: [
      `${VAULT} :: recognizes the burn as IDENTITY_BURNED and removes the identity tracking`,
      `${VAULT} :: after a burn no longer confuses the owner's next spend with any RepID shape`,
    ],
    note:
      'the second case is the load-bearing one: after the burn, the category must ' +
      'not reappear, and the test shows the next spend of the same owner is not ' +
      'read as an identity operation.',
  },
  'SPEC-008/RF-O07': {
    tests: [
      `${SHAPE} :: rejects a genesis whose change output carries a token`,
      `${RATING} :: recognizes an IDENTITY_GENESIS alongside the change output`,
      `${RATING} :: recognizes a RECEIPT_GENESIS alongside the change output`,
    ],
    note:
      'the change output is the case most easily given tokens by accident, and the ' +
      'other two confirm a tokenless change does not stop recognition.',
  },

  // --- SPEC-008 section 4.3, receipt ---------------------------------------
  'SPEC-008/RF-O09': {
    tests: [
      `${SHAPE} :: recognizes a Receipt minted by the covenant and reports the cross pair`,
      `${SHAPE} :: recognizes the same three NFTs without the change output`,
      `${SHAPE} :: rejects a genesis with only two outputs, missing a Rating Right`,
      `${SHAPE} :: rejects a genesis with five outputs, one more than a change output`,
    ],
    note:
      'the recognizer accepts three or four outputs and rejects two or five, so the ' +
      'output count is bounded on both sides. Note the asymmetry with SPEC-009/RF-W38, ' +
      'which accepts the same three or four: the recognizer is deliberately more ' +
      'permissive than the covenant, because a three-output genesis cannot be ' +
      'produced by the covenant but can exist on chain.',
  },
  'SPEC-008/RF-O10': {
    tests: [
      `${SHAPE} :: recognizes a Receipt minted by the covenant and reports the cross pair`,
      `${SHAPE} :: rejects a Rating Right that commits to its own holder`,
      `${SHAPE} :: rejects swapped commitments, which is the same shape read backwards`,
      `${SHAPE} :: rejects a Rating Right with an empty commitment`,
      `${SHAPE} :: rejects a Receipt that carries a non-empty commitment`,
    ],
    note:
      'the cross relationship is checked in both directions. "swapped commitments" ' +
      'is the same valid-looking shape read the other way round, which is the ' +
      'failure mode a one-sided check would miss.',
  },
  'SPEC-008/RF-O11': {
    tests: [
      `${SHAPE} :: recognizes a Receipt minted by the covenant and reports the cross pair`,
      `${SHAPE} :: rejects a genesis whose change output carries a token`,
    ],
    note: 'the change output is checked for both its destination and its contents.',
  },

  // --- SPEC-008 section 4.4, rating ----------------------------------------
  'SPEC-008/RF-O12': {
    tests: [
      `${CONSUME} :: retires the Rating Right when it is spent`,
      `${CONSUME} :: does not attribute a second rating to the same Rating Right`,
      `${CONSUME} :: leaves the other party's Rating Right untouched`,
      `${RATING} :: spends the Rating Right with a score OP_RETURN and burns the NFT (without re-issuing it)`,
    ],
    note:
      'single use is enforced by retiring the outpoint, and the NFT is not ' +
      're-issued, so a second rating cannot be attributed to the same right.',
  },
  'SPEC-008/RF-O13': {
    tests: [
      `${RATING} :: spends the Rating Right with a score OP_RETURN and burns the NFT (without re-issuing it)`,
      `${RATING} :: recognizes a RATING_ISSUED by crossing it with the already indexed Rating Right`,
    ],
    note:
      'the tag and the 1-5 range are exercised end to end; the encoding of the ' +
      'container itself is covered by the RF-W01 and RF-W05 rows.',
  },
  'SPEC-008/RF-O14': {
    tests: [
      `${RATING} :: marks as invalid a RATING_ISSUED whose score is out of the 1-5 range (SPEC-004 RF-04)`,
      `${CONSUME} :: retires the Rating Right even when the score is out of range`,
    ],
    note:
      'the requirement has two halves and both are asserted: the fact is emitted ' +
      'with valid:false rather than dropped, and the Rating Right is still ' +
      'retired. Retiring on an invalid score is what stops a wallet from retrying ' +
      'the same right.',
  },

  // --- SPEC-008 section 4.5, platform validation and trust ------------------
  'SPEC-008/RF-O15': {
    tests: [
      `${PLATFORM} :: recognizes a platform attestation that references an already indexed Receipt`,
      `${PLATFORM} :: marks as invalid a confirmation that references an unknown Receipt`,
    ],
    note:
      'a confirmation is only valid against a Receipt already in the index, so the ' +
      'test that indexes one first is what makes the second meaningful.',
  },
  'SPEC-008/RF-O16': {
    tests: [
      `${TRUST} :: does not recognize an OP_RETURN with a foreign tag or a different payload size`,
    ],
    note:
      'the positive case is the unilateral-declaration test, which is cited under ' +
      'SPEC-008/RF-E07 because it establishes that no Rating Right and no counter-' +
      'signature are needed. The 20-byte payload length is what this row adds.',
  },
  'SPEC-008/RF-O17': {
    tests: [`${TRUST} :: marks a self-trust declaration as invalid (A trusts A)`],
    note: 'self-trust is recognised as a shape and then marked invalid, not dropped.',
  },

  // --- SPEC-008 section 4.6, mutability ------------------------------------
  'SPEC-008/RF-O18': {
    tests: [
      `${SHAPE} :: rejects a Receipt NFT with capability mutable`,
      `${SHAPE} :: rejects a Receipt NFT with capability minting`,
      `${VAULT} :: recognizes the burn as IDENTITY_BURNED and removes the identity tracking`,
      `${RATING} :: spends the Rating Right with a score OP_RETURN and burns the NFT (without re-issuing it)`,
    ],
    note:
      'immutability is observable from two directions: a capability other than ' +
      'none is rejected, and a burn does not re-issue the category. Together they ' +
      'cover both halves of "not mutable nor re-mintable".',
  },
  'SPEC-008/RF-O19': {
    tests: [
      `${CONSUME} :: persists the retirement, so a restart cannot resurrect a spent right`,
      `${VAULT} :: persists the identity tracking in the JSON store and survives a reload`,
    ],
    note:
      'what these show is that retained state is append-only across a restart: a ' +
      'spent right and a burned identity do not come back. They do not show that a ' +
      'fact already indexed can be altered in place, because no code path offers ' +
      'one.',
  },

  // --- SPEC-008 section 5, verification and indexing -----------------------
  'SPEC-008/RF-E07': {
    tests: [
      `${TRUST} :: recognizes a unilateral A\u2192B declaration (only A signs, no Rating Rights)`,
    ],
    note:
      'the only signer is the truster, and no Rating Right is consumed. This is the ' +
      'requirement that makes a Trust Link usable at cold start.',
  },

  // --- SPEC-009, container parsing and recognition --------------------------
  'SPEC-009/RF-W01': {
    tests: [
      `${OPCODE} :: splits a direct tag push followed by a direct payload push`,
      `${OPCODE} :: preserves chunk boundaries instead of concatenating the payload`,
      `${OPCODE} :: preserves a multi-byte payload as a single chunk`,
      `${OPCODE} :: decodes the tag as UTF-8 text`,
    ],
    note: 'the accepted container shape, including that chunks stay separate.',
  },
  'SPEC-009/RF-W02': {
    tests: [
      `${OPCODE} :: rejects OP_0 (0x00) in the tag position`,
      `${OPCODE} :: rejects OP_0 in a payload position`,
      `${OPCODE} :: accepts a pushed zero byte, which is a one-byte chunk and not OP_0`,
      `${OPCODE} :: rejects a zero-length push anywhere`,
    ],
    note:
      'the third case is the discriminating one: a pushed 0x00 byte is a one-byte ' +
      'chunk and must be accepted, while the OP_0 opcode must not. A parser that ' +
      'simply rejects any zero byte would pass the first two and fail this one.',
  },
  'SPEC-009/RF-W05': {
    tests: [
      `${OPCODE} :: does not accept a tag that is a prefix of the real one`,
      `${OPCODE} :: does not accept a tag with the real one as a prefix`,
      `${OPCODE} :: is case sensitive, so a lowercased tag is a different tag`,
      `${OPCODE} :: keeps the other two RepID tags distinct from each other`,
    ],
    note:
      'exact byte equality, in both directions and in case. This is also the row ' +
      'that makes the SPEC-010 section 6 tag-revision rule work: a tag with an ' +
      'unrecognised revision matches nothing.',
  },
  'SPEC-009/RF-W08': {
    tests: [
      `${RATING} :: marks as invalid a RATING_ISSUED whose score is out of the 1-5 range (SPEC-004 RF-04)`,
    ],
    note:
      'a score outside the range yields a fact with valid:false, not a dropped ' +
      'transaction. The same behaviour is cited under RF-O14, which states it as ' +
      'a protocol invariant.',
  },
  'SPEC-009/RF-W21': {
    tests: [
      `${CONSUME} :: retires the Rating Right when it is spent`,
      `${CONSUME} :: does not attribute a second rating to the same Rating Right`,
      `${CONSUME} :: retires the Rating Right even when the score is out of range`,
      `${CONSUME} :: leaves the other party's Rating Right untouched`,
      `${CONSUME} :: persists the retirement, so a restart cannot resurrect a spent right`,
    ],
    note:
      'the requirement is that resolution removes the outpoint from the tracked ' +
      'set. The five cases are the five ways that removal used to fail.',
  },
  'SPEC-009/RF-W38': {
    tests: [
      `${SHAPE} :: recognizes a Receipt minted by the covenant and reports the cross pair`,
      `${SHAPE} :: recognizes the same three NFTs without the change output`,
      `${SHAPE} :: rejects a genesis with only two outputs, missing a Rating Right`,
      `${SHAPE} :: rejects a genesis with five outputs, one more than a change output`,
    ],
    note: 'three or four outputs, and the fourth must be a tokenless change.',
  },
  'SPEC-009/RF-W39': {
    tests: [
      `${SHAPE} :: rejects a Receipt NFT with capability mutable`,
      `${SHAPE} :: rejects a Receipt NFT with capability minting`,
      `${SHAPE} :: rejects a mutable Rating Right even when the Receipt itself is fine`,
      `${SHAPE} :: rejects a minting Rating Right`,
      `${SHAPE} :: rejects an NFT that carries a fungible amount`,
      `${SHAPE} :: rejects NFTs that do not share one category`,
    ],
    note: 'capability, fungible amount and the single shared category.',
  },
  'SPEC-009/RF-W40': {
    tests: [
      `${SHAPE} :: rejects a Rating Right that commits to its own holder`,
      `${SHAPE} :: rejects swapped commitments, which is the same shape read backwards`,
      `${SHAPE} :: rejects a Rating Right with an empty commitment`,
      `${SHAPE} :: rejects a Receipt that carries a non-empty commitment`,
    ],
    note: 'the cross relationship and the empty commitment on the Receipt itself.',
  },
  'SPEC-009/RF-W45': {
    tests: [
      `${OPCODE} :: rejects a final push that claims more bytes than remain`,
      `${OPCODE} :: rejects a tag push that claims more bytes than remain`,
      `${OPCODE} :: rejects a middle push that runs past the end, ignoring the trailing bytes`,
      `${OPCODE} :: accepts a length that exactly consumes the remaining bytes`,
    ],
    note:
      'a push that declares more bytes than the script contains is refused, and ' +
      'the exact boundary is accepted, so the rule is not implemented as a ' +
      'stricter-than-required comparison.',
  },
  // --- SPEC-009 section 12, binding verification (optional) ------------------
  'SPEC-009/RF-W47': {
    tests: [
      `${BINDING} :: reveals the canonical redeem script on the vault input`,
      `${BINDING} :: reveals the canonical redeem script on the receipt input`,
      `${BINDING} :: pushes the constructor arguments in reverse declaration order`,
      `${BINDING} :: differs per owner, which is why the expected script is rebuilt`,
      `${BINDING} :: rejects a scriptSig whose last push is the covenant body without its args`,
      `${REAL} :: still binds the identity covenants, which this version did not change`,
    ],
    note:
      'the expected script is rebuilt from the canonical bytecode plus the pkh ' +
      'values the recognizer already read, never compared against a constant. The ' +
      'real-chain half matters because it is compiled and broadcast by a toolchain ' +
      'that did not write the check. It covers the two identity covenants rather ' +
      'than the receipt: adding the distinct-parties rule changed only the receipt ' +
      'bytecode, so the receipt transaction on chain was minted by the previous ' +
      'one and is cited under RF-W49 as a known consequence.',
  },
  'SPEC-009/RF-W48': {
    tests: [
      `${BINDING} :: accepts the classic 23-byte P2SH form as well as the CashTokens one`,
      `${BINDING} :: reads the long push form, which is what these scripts need`,
    ],
    note:
      'both P2SH hash forms are accepted and the function is selected from the ' +
      'width found, so the same 20 bytes under the 32-byte form does not match.',
  },
  'SPEC-009/RF-W49': {
    tests: [
      `${BINDING} :: reports a vault locked to a foreign P2SH as a valid identity today`,
      `${BINDING} :: reports a receipt whose covenant was never run as a valid receipt today`,
      `${BINDING} :: rejects a P2PKH output as a vault, which a hash check alone would miss`,
      `${BINDING} :: does not accept a receipt whose covenant was instantiated for other parties`,
      `${BINDING} :: rejects a scriptSig whose last push is the covenant body without its args`,
      `${BINDING} :: reports a scriptSig with no final push instead of guessing at its tail`,
      `${SEAM} :: reports an impostor vault genesis as an identity`,
      `${SEAM} :: reports a vault genesis re-pointed at a foreign script as an identity`,
      `${SEAM} :: rejects a vault genesis revealing a foreign script, leaving no trace`,
      `${SEAM} :: rejects a receipt genesis that reveals the body without its arguments`,
      `${SEAM} :: rejects a top-up revealing a foreign script without moving the tracking`,
      `${REAL} :: no longer recognizes the receipt genesis on chain, whose rights were in P2PKH`,
    ],
    note:
      'the first tests are the impostors the base recognizer accepts today, which ' +
      'is what makes them worth asserting: the vector is the live gap, not a ' +
      'hypothetical one. The seam tests are the same impostors built by rewriting a ' +
      'real covenant transaction, run through indexRawTransaction itself, which is ' +
      'the only place the verdict is actually consumed. The last one is not an ' +
      'impostor but a consequence: a real receipt broadcast under the 0.1.0 ' +
      'covenant no longer binds against the 0.2.0 bytecode. It is asserted as ' +
      'such rather than deleted, because a check that quietly stops covering ' +
      'history is worse than one that reports that it does.',
  },
  'SPEC-009/RF-W50': {
    tests: [
      `${REAL} :: does not recognize the historical ratings, whose Rating Right was never tracked`,
      `${SEAM} :: recognizes ratings, which have no covenant, without rejecting them`,
      `${SEAM} :: gives identical results with and without binding for trust links`,
    ],
    note:
      'a control case. Requiring binding of a fact that has no covenant behind it ' +
      'would be a false rejection, so the ratings and the trust link are asserted ' +
      'to survive binding untouched, the trust link by asserting both modes return ' +
      'the identical fact.',
  },
  'SPEC-008/RF-V12': {
    tests: [
      `${SEAM} :: accepts a genuine vault genesis and establishes an identity`,
      `${SEAM} :: rejects a vault genesis revealing a foreign script, leaving no trace`,
      `${SEAM} :: accepts a genuine top-up and advances the collateral`,
      `${SEAM} :: rejects a top-up revealing a foreign script without moving the tracking`,
    ],
    note:
      'the rule is only as strong as the store it changes, so every assertion ' +
      'pairs the fact with getIdentityByOwner rather than with the returned fact ' +
      'alone. The rejected cases assert the store is byte-for-byte unchanged, ' +
      'because an identity recorded against a covenant that never ran is the ' +
      'failure this requirement exists to prevent.',
  },
  'SPEC-008/RF-V13': {
    tests: [
      `${SEAM} :: still recognizes a legacy genesis, and gives it no identity`,
      `${SEAM} :: withholds standing from a vault genesis whose output is a plain P2PKH`,
    ],
    note:
      'both halves in one test: the legacy fact is still returned, so nothing is ' +
      'deprecated, while getIdentityByOwner finds nothing, so nothing is granted. ' +
      'The second test is the same distinction reached from the other side — a ' +
      'genesis whose covenant output was swapped for a P2PKH is indistinguishable ' +
      'from the legacy form by shape, and degrades to a fact with no standing ' +
      'instead of to an identity.',
  },
  'SPEC-009/RF-W52': {
    tests: [
      `${SEAM} :: accepts a genuine vault genesis and establishes an identity`,
      `${SEAM} :: withholds standing from a vault genesis whose output is a plain P2PKH`,
    ],
    note:
      'the recognition side of RF-V12, showing the bytes match before the standing ' +
      'is granted and the standing is withheld when they do not.',
  },
  'SPEC-009/RF-W53': {
    tests: [
      `${BINDING} :: emits no binding verdict for a legacy genesis, instead of a failed one`,
      `${SEAM} :: still recognizes a legacy genesis, and gives it no identity`,
    ],
    note:
      'the legacy form is out of scope for binding and stays recognized. The test ' +
      'also pins why the order matters: a P2PKH spend ends in a 65-byte signature, ' +
      'so reading the unlocking script first would make a legacy genesis ' +
      'indistinguishable from a vault instantiated for the wrong owner.',
  },
  'SPEC-008/RF-O821': {
    tests: [
      `${SHAPE} :: rejects a receipt genesis whose two Rating Rights name the same party`,
    ],
    note:
      'the recognizer half. The covenant half is not asserted here for the same ' +
      'reason as RF-O04: cashc compiles the require, and this repository has no ' +
      'harness that runs the Bitcoin VM against it. What is asserted is that the ' +
      'recognizer refuses the shape with binding off, because it is readable from ' +
      'the outputs and a genesis minted under the 0.1.0 covenant is still on chain.',
  },
  'SPEC-009/RF-W55': {
    tests: [
      `${SHAPE} :: rejects a receipt genesis whose two Rating Rights name the same party`,
    ],
    note:
      'the one receipt impostor that satisfies RF-W40: with one party, each ' +
      'commitment correctly names the other, so the cross pairing holds and only ' +
      'the distinctness requirement catches it. Required with binding off, since ' +
      'it is a fact about the outputs rather than about whether a covenant ran.',
  },
  'SPEC-009/RF-W56': {
    tests: [
      `${REAL} :: no longer recognizes the receipt genesis on chain, whose rights were in P2PKH`,
    ],
    note:
      'the prohibition is asserted by what the implementation does not do. The ' +
      'Chipnet receipt was minted from the 0.1.0 body and the SDK holds only the ' +
      '0.2.0 one; a fallback would bind it, and the test requires the verdict to ' +
      'be "does not match". It cannot prove no fallback exists for some other ' +
      'bytecode, so what it pins is the decision: the transaction stays unbound ' +
      'even though a matching earlier version is known and checkable.',
  },
  'SPEC-009/RF-W57': {
    tests: [
      `${REAL} :: no longer recognizes the receipt genesis on chain, whose rights were in P2PKH`,
    ],
    note:
      'both halves of the requirement, on one real transaction. No fact at all ' +
      'with binding applied, rather than a fact marked invalid, and the same ' +
      'transaction still recognized without binding, which is what distinguishes ' +
      '"unverified" from "forged" (SPEC-009 section 12.3).',
  },

  // --- SPEC-009 section 4/8/9/12, the 0.4.0 recognition vectors -------------
  // Annex B.3 vectors 1-14, executed as raw-byte transactions in one file so
  // each row of the table is a test the Annex can be read against.
  'SPEC-009/RF-W64': {
    tests: [
      `${B3} :: issues a RATING_ISSUED with score and commentHash from a well-formed REPID_RATING2`,
    ],
    note:
      'the three-chunk form is decoded into score and commentHash, the rater and ' +
      'ratee are resolved from the spent Rating Right, and the fact carries both ' +
      'the score and the hash.',
  },
  'SPEC-009/RF-W65': {
    tests: [
      `${B3} :: emits no fact for a REPID_RATING2 with only the score`,
      `${B3} :: emits no fact for a REPID_RATING2 shaped like the two-chunk REPID_RATING1`,
    ],
    note:
      'both wrong-shape cases under the RATING2 tag yield nothing, never a ' +
      'reading of the empty slot: one byte alone is the wrong chunk count, and a ' +
      'two-byte payload is the wrong chunk sizes.',
  },
  'SPEC-009/RF-W66': {
    tests: [
      `${B3} :: a valid retraction of a rating its signer issued`,
    ],
    note:
      'a well-formed RETRACT1 is emitted as a RATING_RETRACTION with the spender ' +
      'and the referenced Receipt, and the reference is kept for later repeats.',
  },
  'SPEC-009/RF-W67': {
    tests: [
      `${B3} :: a retraction whose payload is 20 bytes, not 32`,
    ],
    note: 'a non-32-byte reference or wrong chunk count is a malformed container, so no fact.',
  },
  'SPEC-009/RF-W68': {
    tests: [
      `${B3} :: a retraction of a rating this recognizer never saw`,
    ],
    note: 'an unknown reference is a claim, not a retraction: the fact is emitted, marked invalid.',
  },
  'SPEC-009/RF-W69': {
    tests: [
      `${B3} :: a retraction spent by a wallet that is not the rating signer`,
    ],
    note:
      'the spender derives from the P2PKH scriptSig per SPEC-009 section 5; a ' +
      'spender who never signed the referenced rating is marked invalid.',
  },
  'SPEC-009/RF-W70': {
    tests: [
      `${B3} :: a second retraction of an already-retracted rating`,
    ],
    note:
      'the first retraction enters the retracted set, the second is recognized ' +
      'and marked invalid, and the original RATING_ISSUED is untouched in the ' +
      'ratings index.',
  },
  'SPEC-009/RF-W71': {
    tests: [
      `${B3} :: a party of the Receipt cannot corroborate its own interaction`,
      `${B3} :: a third party who is neither party still corroborates`,
    ],
    note:
      'both halves in one store: a party of the Receipt is marked invalid, and ' +
      'the same receipt is confirmed by a third entity, which keeps the rule from ' +
      'being implemented as a blanket refusal.',
  },
  'SPEC-009/RF-W72': {
    tests: [
      `${B3} :: a valid retraction of a rating its signer issued`,
      `${B3} :: a second retraction of an already-retracted rating`,
    ],
    note:
      'the retracted set retains the reference (RF-27) so a repeat is invalid; ' +
      'the negative case in RF-W70 shows the retention survives an invalid ' +
      'attempt, so only valid retractions record. The consume of the Rating ' +
      'Right is exercised by the rating recognizer that precedes the retraction.',
  },
  'SPEC-009/RF-W73': {
    tests: [
      `${B3} :: decodes a 4-byte 0x10 context, keeping unknown values raw`,
      `${B3} :: decodes a 36-byte 0x11 context with its contextHash`,
      `${B3} :: rejects every foreign commitment shape`,
    ],
    note:
      'the two fixed forms are decoded into the receiptContext fields, unknown ' +
      'category and role bytes stay raw, and every length or format byte outside ' +
      'the two forms — including reserved flags and the wrong length for a form — ' +
      'is read as no fact, not as a variant.',
  },
  'SPEC-009/RF-W74': {
    tests: [
      `${B3} :: decodes a 4-byte 0x10 context, keeping unknown values raw`,
      `${B3} :: decodes a 36-byte 0x11 context with its contextHash`,
    ],
    note:
      'both context tests assert the context is retained, not only decoded: ' +
      'store.getReceipt(receipt.txid).receiptContext equals the fact field, which ' +
      'is what a later self-corroboration or context read depends on.',
  },
  'SPEC-009/RF-W76': {
    tests: [
      `${B3} :: rejects a spend revealing the 0.4.0 body for an identity recorded under 0.3.0`,
      `${B3} :: the same spend is a burn when the identity records 0.4.0`,
      `${B3} :: an identity recorded without a version cannot be spent under binding at all`,
      `${B3} :: with binding off, the same spend is still reported: shape recognition claims nothing about covenants`,
    ],
    note:
      'the applied version is the one recorded at genesis, never an on-the-fly ' +
      'match: a 0.4.0 reveal under a 0.3.0 record is rejected with no trace, the ' +
      'same bytes are a burn under a 0.4.0 record, an unrecorded version cannot ' +
      'name the body and rejects, and shape recognition without binding makes no ' +
      'covenant claim at all.',
  },
};

/**
 * Requirements with no automated test, and why. A reason is required: an
 * undeclared gap cannot be counted, and a gap that cannot be counted never gets
 * closed.
 */
/** A requirement with no automated test: why not, and what would close it. */
export interface Uncovered {
  readonly why: string;
  readonly fix: string;
}

export const UNCOVERED: Readonly<Record<string, Uncovered>> = {
  'SPEC-008/RF-O02': {
    why: 'Covenant property plus a CashTokens consensus rule: the genesis category is the spent outpoint txid and that outpoint must be vout 0. No recognizer behaviour can be tested against it, because the recognizer reads the category rather than deriving it. Evidence is the real-VM E2E in the demo, not a unit test.',
    fix: 'a test that builds a genesis from vout 1 and observes the rejection',
  },
  'SPEC-008/RF-O04': {
    why: 'The covenant requires the owner signature on all three spend paths. It is exercised by every builder-driven mint, because the builder runs the contract in a debug VM, but no test asserts that a missing or wrong signature is refused. A negative test needs a signing setup the current tooling cannot express without a custom unlocker.',
    fix: 'blocked on tooling, not on effort',
  },
  'SPEC-008/RF-O08': {
    why: 'The joint signature of both parties is required by the covenant and enforced when the E2E mints a Receipt, but no test asserts that a one-sided signature is refused. Same tooling limitation as RF-O04.',
    fix: 'blocked on tooling, not on effort',
  },
  'SPEC-008/RF-O20': {
    why: 'A prohibition, not a behaviour: no on-chain rule may encode a value judgment. An assertion cannot prove the absence of a class of code. Verified by enumerating all 60 require statements in the three covenants, recorded in CONSTITUTION-AUDIT.md Article 1.',
    fix: 'verified by inspection; not convertible into a test',
  },
  // --- Binding verification, opt-in by construction ---------------------------
  // RF-V12, RF-V13 and RF-W52 are cited above: the module's verdict is now
  // consumed by indexRawTransaction, and the store has an identity to withhold.
  // What remains here is what section 12 permits or claims rather than does.
  'SPEC-009/RF-W46': {
    why: 'A permission, not a behaviour. "MAY verify binding" cannot fail, so a test for it would assert that an option exists in the type system at most. Its substance is tested under RF-W47 and RF-W49.',
    fix: 'verified by the RF-W47 and RF-W49 citations; not convertible into a separate test',
  },
  'SPEC-009/RF-W51': {
    why: 'A prohibition on a claim rather than on a behaviour: binding must not be described as signature verification. No assertion can prove how prose describes itself.',
    fix: 'verified by inspection of the module header and SPEC-009 section 12.4, both of which state the limit; not convertible into a test',
  },
  'SPEC-009/RF-W54': {
    why: 'The capability declaration is a claim an implementation makes about itself, and the honest test is that the claim is false when a covenant-backed path is left unverified. The verdict is now consumed at every covenant-backed path in SPEC-009 section 12, but no implementation declares that capability anywhere, so there is still nothing to assert a false declaration against.',
    fix: 'add a declared capability alongside the binding option, then assert that declaring it while any covenant-backed path stays unbound is rejected',
  },
};

/**
 * Why the remaining requirements of a specification have no citation. Used for
 * every requirement of that specification that is not in `COVERED`, so a new
 * requirement is covered by an existing explanation rather than silently
 * appearing as undeclared.
 */
export const SPEC_DEFAULT_REASON: Readonly<Record<string, string>> = {
  'SPEC-001':
    'Legacy specification, retained as the record of RFC-001. Its requirements are restated normatively in SPEC-008 section 4, where they are mapped to tests; this specification adds no requirement that is not covered there.',
  'SPEC-002':
    'Legacy specification for the off-chain interaction layer, which lives in the demo repository and is exercised by that repository\'s own tests. SPEC-008 section 2 restates it normatively.',
  'SPEC-003':
    'Legacy specification. The Receipt invariants are restated in SPEC-008 sections 4.3 and 4.5, where the relevant requirements are mapped to tests.',
  'SPEC-004':
    'Legacy specification for rating. The invariants are restated in SPEC-008 section 4.4, where RF-O12, RF-O13 and RF-O14 are mapped to tests. The score-range requirement is additionally cited by the test that enforces it.',
  'SPEC-005':
    'Legacy specification for the indexer. Recognition requirements are restated in SPEC-009, where the container-parsing and Receipt-shape requirements are mapped to tests.',
  'SPEC-006':
    'Legacy specification for the Trust Link. Restated in SPEC-008 section 4.5; RF-O16, RF-O17 and RF-E07 are mapped to tests.',
  'SPEC-008':
    'Declared normative, but not yet mapped to a specific test. This is the largest remaining traceability gap and the one worth closing first: these are the on-chain invariants and the recognition rules the protocol exists to define.',
  'SPEC-009':
    'Recognition and wire-format requirement without a citation. The 0.4.0 Annex B.3 vectors are cited above; what remains uncited are the container-parsing and reading-discipline rules restated from B.2, which RF-W38, RF-W40 and RF-W45 already pin for the wire format and this manifest records as the standing coverage-work item.',
};

/**
 * Minimum share of each specification's requirements that must carry a citation.
 * This is a floor, not a target: it exists so that coverage cannot silently
 * regress, and it is expected to rise. Raising it is the standing work.
 */
export const COVERAGE_FLOOR: Readonly<Record<string, number>> = {
  'SPEC-008': 0.2,
  'SPEC-009': 0.18,
};
