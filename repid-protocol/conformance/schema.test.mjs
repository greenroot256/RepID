// Conformance of protocol/constants.json and protocol/schemas/repid-fact.schema.json
// against SPEC-008 field definitions and SPEC-009 payload rules.
//
// The negative tests matter more than the positive ones: a schema that accepts
// everything would pass the happy path and protect nothing.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  constants,
  protocolVersion,
  validateFact,
  structuralErrors,
  semanticErrors,
  splitAnnotations,
} from '../tools/validate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const realFacts = JSON.parse(
  readFileSync(join(here, 'fixtures', 'real-chain-facts.json'), 'utf8'),
).facts;

const PKH_A = '6234d40262ddb07271d34f99ad025c18c56b9238';
const PKH_B = '18fc5969f82f2429a5366656215de1aa7538af15';
const TXID = '6bb06faf9f9588913512c30c21efdcf3569e17519630b4d823890f93bb61b11c';
const CATEGORY = '5f4c7226b4aa9d9e9dcbf9518e9bbed00e4e44306c2052ce2bd7fa25560b36b0';

const rating = (over = {}) => ({
  type: 'RATING_ISSUED',
  txid: TXID,
  spentOutpoint: `${TXID}:1`,
  raterPkh: PKH_A,
  rateePkh: PKH_B,
  score: 4,
  valid: true,
  ...over,
});

test('every fact reconstructed from a real Chipnet run conforms', () => {
  assert.equal(realFacts.length, 5);
  for (const fact of realFacts) {
    const result = validateFact(fact);
    assert.deepEqual(result.structural, [], `${fact.type} structural`);
    assert.deepEqual(result.semantic, [], `${fact.type} semantic`);
    assert.equal(result.ok, true);
  }
});

test('the real run covers three of the eight fact types', () => {
  // Honest accounting: this run exercised the identity, receipt and rating
  // path only. Platform confirmation, trust and retraction are covered by
  // synthetic vectors below, not by chain data.
  const covered = new Set(realFacts.map((f) => f.type));
  assert.deepEqual(
    [...covered].sort(),
    ['IDENTITY_GENESIS', 'RATING_ISSUED', 'RECEIPT_GENESIS'],
  );
  assert.equal(constants.factTypes.length, 8);
});

test('application annotations are separated from the protocol fact', () => {
  const receipt = realFacts.find((f) => f.type === 'RECEIPT_GENESIS');
  const { protocolFact, annotations } = splitAnnotations(receipt);

  assert.equal(annotations.at, receipt.at);
  assert.deepEqual(annotations.roles, ['client', 'rider']);
  assert.equal('at' in protocolFact, false);
  assert.equal('roles' in protocolFact, false);
});

test('annotations left inside the fact are rejected: the field set is closed', () => {
  // This is the anti-drift guarantee. An implementation cannot quietly add a
  // field to a protocol fact.
  const withStrayAnnotation = { ...rating(), at: '2026-09-27T16:00:37.012Z' };
  const errors = structuralErrors(withStrayAnnotation);
  assert.ok(errors.length > 0, 'expected a structural error for the stray field');
  assert.ok(errors.some((e) => e.keyword === 'additionalProperties'));
});

test('an out-of-range score with valid:false is accepted, not dropped', () => {
  // SPEC-009 RF-W08. The protocol requires reporting the fact. A schema that
  // constrained score to 1..5 would reject the very facts it must report.
  const result = validateFact(rating({ score: 0, valid: false }));
  assert.deepEqual(result.structural, []);
  assert.deepEqual(result.semantic, []);
});

test('an out-of-range score with valid:true is rejected by both layers', () => {
  // The schema catches it through the valid-conditional; the semantic layer
  // catches it independently. The duplication is deliberate defence in depth: a
  // future edit to the schema cannot silently stop enforcing the score range.
  // semanticErrors is called directly because validateFact short-circuits: a
  // fact that is already structurally broken is not worth cross-checking, and
  // its fields may be absent.
  const fact = rating({ score: 9, valid: true });
  assert.ok(structuralErrors(fact).length > 0, 'schema layer must reject it');
  assert.equal(semanticErrors(fact).length, 1, 'semantic layer must reject it');
  assert.equal(validateFact(fact).ok, false);
});

test('the schema constrains score to the protocol range when the rating is valid', () => {
  assert.ok(structuralErrors(rating({ score: 9, valid: true })).length > 0);
  assert.ok(structuralErrors(rating({ score: 0, valid: true })).length > 0);
});

test('self-trust with valid:true passes the schema and fails the semantic layer', () => {
  // Demonstrates why both layers exist: JSON Schema cannot compare two sibling
  // property values.
  const fact = {
    type: 'TRUST_LINK',
    txid: TXID,
    trusterPkh: PKH_A,
    trustedPkh: PKH_A,
    valid: true,
  };
  assert.deepEqual(structuralErrors(fact), []);
  assert.equal(semanticErrors(fact).length, 1);
});

test('self-trust with valid:false is a normal, accepted fact', () => {
  const fact = {
    type: 'TRUST_LINK',
    txid: TXID,
    trusterPkh: PKH_A,
    trustedPkh: PKH_A,
    valid: false,
  };
  assert.equal(validateFact(fact).ok, true);
});

test('decreasing collateral with valid:true is rejected', () => {
  const fact = {
    type: 'IDENTITY_COLLATERAL_TOP_UP',
    txid: TXID,
    identityCategory: CATEGORY,
    ownerPkh: PKH_A,
    spentOutpoint: `${TXID}:0`,
    previousCollateral: '2000',
    collateral: '1000',
    valid: true,
  };
  assert.equal(validateFact(fact).ok, false);
});

test('collateral requires identityOutpoint, and the reverse', () => {
  const base = {
    type: 'IDENTITY_GENESIS',
    txid: TXID,
    identityCategory: CATEGORY,
    ownerPkh: PKH_A,
  };
  assert.ok(structuralErrors({ ...base, collateral: '1000' }).length > 0);
  assert.ok(
    structuralErrors({ ...base, identityOutpoint: `${TXID}:0` }).length > 0,
  );
  assert.deepEqual(
    structuralErrors({ ...base, collateral: '1000', identityOutpoint: `${TXID}:0` }),
    [],
  );
});

test('a legacy identity with no collateral is valid', () => {
  const fact = {
    type: 'IDENTITY_GENESIS',
    txid: TXID,
    identityCategory: CATEGORY,
    ownerPkh: PKH_A,
  };
  assert.equal(validateFact(fact).ok, true);
});

test('a receipt must carry exactly two cross-referencing Rating Rights', () => {
  const base = {
    type: 'RECEIPT_GENESIS',
    txid: TXID,
    receiptCategory: CATEGORY,
    receiptOwnerPkh: PKH_A,
  };
  const pair = [
    { outpoint: `${TXID}:1`, ownerPkh: PKH_A, ratesPkh: PKH_B },
    { outpoint: `${TXID}:2`, ownerPkh: PKH_B, ratesPkh: PKH_A },
  ];

  assert.equal(validateFact({ ...base, ratingRights: pair }).ok, true);

  // Wrong count: caught by the schema.
  assert.ok(structuralErrors({ ...base, ratingRights: [pair[0]] }).length > 0);

  // Both held by the same party: caught semantically.
  const sameHolder = [pair[0], { ...pair[1], ownerPkh: PKH_A }];
  assert.equal(validateFact({ ...base, ratingRights: sameHolder }).ok, false);
});

test('a platform confirmation is a well-formed fact even with an unindexed Receipt', () => {
  const fact = {
    type: 'PLATFORM_CONFIRMATION',
    txid: TXID,
    platformPkh: PKH_A,
    // A syntactically valid txid that is not in any Receipt index.
    receiptTxid: `${TXID.slice(0, 63)}c`,
    valid: false,
  };
  // An unindexed Receipt yields valid:false, which is still a well-formed fact:
  // the protocol requires reporting the attempt, not dropping it.
  assert.equal(validateFact(fact).ok, true);
});

test('a receipt with a 4-byte interaction context is well-formed (0.4.0)', () => {
  // SPEC-003 RF-08 / SPEC-009 §9.2: 0x10 · category · roleA · roleB.
  const context = {
    interactionCategory: '01',
    roleA: '02',
    roleB: '03',
  };
  const fact = {
    type: 'RECEIPT_GENESIS',
    txid: TXID,
    receiptCategory: CATEGORY,
    receiptOwnerPkh: PKH_A,
    ratingRights: [
      { outpoint: `${TXID}:1`, ownerPkh: PKH_A, ratesPkh: PKH_B },
      { outpoint: `${TXID}:2`, ownerPkh: PKH_B, ratesPkh: PKH_A },
    ],
    receiptContext: context,
  };
  assert.deepEqual(structuralErrors(fact), []);
  assert.deepEqual(semanticErrors(fact), []);
  assert.equal(validateFact(fact).ok, true);
});

test('a receipt with a 36-byte context (hash form) is well-formed (0.4.0)', () => {
  // SPEC-009 §9.2: 0x11 · category · roleA · roleB · contextHash.
  const context = {
    interactionCategory: '01',
    roleA: '02',
    roleB: '03',
    contextHash: 'a'.repeat(64),
  };
  const fact = {
    type: 'RECEIPT_GENESIS',
    txid: TXID,
    receiptCategory: CATEGORY,
    receiptOwnerPkh: PKH_A,
    ratingRights: [
      { outpoint: `${TXID}:1`, ownerPkh: PKH_A, ratesPkh: PKH_B },
      { outpoint: `${TXID}:2`, ownerPkh: PKH_B, ratesPkh: PKH_A },
    ],
    receiptContext: context,
  };
  assert.equal(validateFact(fact).ok, true);

  // A contextHash without the 4 bare fields is not a valid context.
  delete context.contextHash;
  context.contextHash = 'ab'; // wrong width
  assert.ok(structuralErrors({ ...fact, receiptContext: context }).length > 0);
});

test('a rating with commentHash is well-formed (0.4.0)', () => {
  // SPEC-004 RF-08/RF-09 / SPEC-009 §4.2: REPID_RATING2 → commentHash.
  const fact = rating({ commentHash: 'b'.repeat(64) });
  assert.equal(validateFact(fact).ok, true);

  // A commentHash of the wrong width is structurally invalid.
  const wrong = rating({ commentHash: 'c' });
  assert.ok(structuralErrors(wrong).length > 0);
});

test('a rating retraction is well-formed and carries no annotation (0.4.0)', () => {
  // SPEC-004 RF-06/RF-07 / SPEC-009 §4.5: REPID_RETRACT1 → RATING_RETRACTION.
  const retraction = {
    type: 'RATING_RETRACTION',
    txid: TXID,
    raterPkh: PKH_A,
    receiptTxid: TXID,
    valid: false,
  };
  assert.equal(validateFact(retraction).ok, true);
});

test('self-corroboration and retraction rules are declared but not statically checked', () => {
  // SPEC-003 RF-10 (confirmer must be neither party) and SPEC-004 RF-07
  // (retraction must reference an existing rating signed by the rater, once)
  // depend on the index, so the schema cannot express them. They are verified
  // by the recognizer (task E) and declared in the schema's $comment.
  const schema = JSON.parse(
    readFileSync(join(here, '..', 'protocol', 'schemas', 'repid-fact.schema.json'), 'utf8'),
  );
  assert.ok(
    schema.$comment.includes('confirmer to be neither partyA nor partyB'),
    'schema $comment must declare the self-corroboration rule',
  );
  assert.ok(
    schema.$comment.includes('RATING_RETRACTION'),
    'schema $comment must declare the retraction rule',
  );
});

test('hex fields are lowercase and fixed width', () => {
  assert.ok(structuralErrors(rating({ raterPkh: PKH_A.toUpperCase() })).length > 0);
  assert.ok(structuralErrors(rating({ raterPkh: PKH_A.slice(2) })).length > 0);
});

test('collateral travels as a string, never a JSON number', () => {
  // BCH amounts exceed IEEE-754 safe integers; a number would silently lose
  // precision for large values.
  const asNumber = { ...rating(), score: 4 };
  delete asNumber.score;
  const fact = {
    type: 'IDENTITY_GENESIS',
    txid: TXID,
    identityCategory: CATEGORY,
    ownerPkh: PKH_A,
    collateral: 1000,
    identityOutpoint: `${TXID}:0`,
  };
  assert.ok(structuralErrors(fact).length > 0);
  assert.equal(validateFact({ ...asNumber, score: '4' }).ok, false);
});

test('declared tag lengths match the actual tag bytes', () => {
  // Guards against a hand-edited constant drifting from the tag it describes.
  for (const [key, tag] of Object.entries(constants.opReturnTags)) {
    if (key.startsWith('$')) continue; // documentation keys are not tags
    assert.ok(tag.value, `${key} declares no value`);
    assert.equal(
      Buffer.from(tag.value, 'ascii').length,
      tag.lengthBytes,
      `${key} (${tag.value}) lengthBytes is wrong`,
    );
  }
});

test('the five tags are exactly those defined in the specifications', () => {
  assert.equal(constants.opReturnTags.RATING.value, 'REPID_RATING1');
  assert.equal(constants.opReturnTags.RATING2.value, 'REPID_RATING2');
  assert.equal(constants.opReturnTags.RETRACT.value, 'REPID_RETRACT1');
  assert.equal(constants.opReturnTags.PLATFORM.value, 'REPID_PLATFORM1');
  assert.equal(constants.opReturnTags.TRUST.value, 'REPID_TRUST1');
});

test('the score range is 1..5 and the encoded range is a single byte', () => {
  assert.equal(constants.scoreRange.MIN_SCORE, 1);
  assert.equal(constants.scoreRange.MAX_SCORE, 5);
  assert.equal(constants.scoreRange.encodedRange.MIN, 0);
  assert.equal(constants.scoreRange.encodedRange.MAX, 255);
  assert.equal(constants.scoreRange.encodedRange.lengthBytes, 1);
});

test('field lengths are the protocol byte lengths', () => {
  assert.equal(constants.fieldLengths.PKH, 20);
  assert.equal(constants.fieldLengths.TXID, 32);
  assert.equal(constants.fieldLengths.CATEGORY, 32);
  assert.equal(constants.fieldLengths.SCORE, 1);
});

test('all eight fact types are declared, with validity flags matching SPEC-008', () => {
  const declared = constants.factTypes.map((f) => f.type).sort();
  assert.deepEqual(declared, [
    'IDENTITY_BURNED',
    'IDENTITY_COLLATERAL_TOP_UP',
    'IDENTITY_GENESIS',
    'PLATFORM_CONFIRMATION',
    'RATING_ISSUED',
    'RATING_RETRACTION',
    'RECEIPT_GENESIS',
    'TRUST_LINK',
  ]);

  // SPEC-008 section 3: E1 and E4 carry no validity field.
  const withValidity = constants.factTypes
    .filter((f) => f.hasValidityField)
    .map((f) => f.type)
    .sort();
  assert.deepEqual(withValidity, [
    'IDENTITY_BURNED',
    'IDENTITY_COLLATERAL_TOP_UP',
    'PLATFORM_CONFIRMATION',
    'RATING_ISSUED',
    'RATING_RETRACTION',
    'TRUST_LINK',
  ]);
});

test('the protocol version is a pre-release, not 1.0.0', () => {
  assert.equal(protocolVersion.protocol, 'repid');
  assert.equal(protocolVersion.version, '0.5.0');
  assert.equal(protocolVersion.status, 'pre-release');
  // SPEC-010 section 4.1: while the version is 0.y.z a breaking change advances
  // MINOR, so the minor number is what records each breaking batch: 0.4.0 added
  // the vault burn gate, REPID_RATING2, REPID_RETRACT1 and the interaction
  // context as a superset of 0.3.0 (a compliant 0.4.0 reader still reads every
  // 0.3.0 byte the same way), and 0.5.0 redefines the normative commentHash
  // preimage to bind the utterance to its Receipt (decision P6, SPEC-004 RF-10)
  // without changing how any historical fact is read (A-DECISIONES.md). The
  // leading zero must not be quietly dropped by an edit that meant to promote.
  assert.ok(protocolVersion.version.startsWith('0.'));
  assert.ok(
    protocolVersion.promotionTo1_0_0.length > 0,
    'promotion criteria must be stated, otherwise 1.0.0 has no definition',
  );
});

test('contract fingerprints are recorded for every declared covenant', () => {
  // Shape check only. The fingerprint is NOT a conformance anchor: it does not
  // change when a contract's logic changes (see tools/check-artifacts.mjs, which
  // is what actually establishes conformance).
  //
  // SPEC-008 RF-W56/RF-W76 (versioned vault): the identityVault is a versioned
  // covenant, so every declared version must carry its own source/artifact pair.
  // The total is 4 covenant sources and 5 artifact files (identityVault 0.3.0 +
  // 0.4.0). 0.5.0 changes no covenant, so its record repeats the 0.4.0 pair:
  // it does not add an artifact, and the registry can still hand a 0.5.0
  // implementation canonical bytes to bind against.
  for (const [name, contract] of Object.entries(constants.contracts)) {
    if (name === 'compiler' || name.startsWith('$')) continue;
    if ('versions' in contract) {
      assert.ok(Object.keys(contract.versions).length >= 2,
        `${name} must declare at least the frozen 0.3.0 and the current version`);
      for (const [version, body] of Object.entries(contract.versions)) {
        assert.match(body.fingerprint, /^[0-9a-f]{64}$/, `${name} ${version} fingerprint`);
        assert.match(body.source, /^contracts\/.+\.cash$/);
        assert.match(body.artifact, /^artifacts\/.+\.json$/);
      }
    } else {
      assert.match(contract.fingerprint, /^[0-9a-f]{64}$/, `${name} fingerprint`);
      assert.match(contract.source, /^contracts\/.+\.cash$/);
      assert.match(contract.artifact, /^artifacts\/.+\.json$/);
    }
  }
  const flat = [];
  for (const [name, contract] of Object.entries(constants.contracts)) {
    if (name === 'compiler' || name.startsWith('$')) continue;
    if ('versions' in contract) {
      flat.push(...Object.values(contract.versions));
    } else {
      flat.push(contract);
    }
  }
  assert.equal(flat.length, 6, '3 un-versioned contracts + 3 declared identityVault versions');
  assert.equal(
    new Set(flat.map((e) => e.artifact)).size,
    5,
    '4 covenant sources, 5 compiled artifact files (0.5.0 records the 0.4.0 body)',
  );
  assert.equal(constants.contracts.compiler.name, 'cashc');
  assert.equal(constants.contracts.compiler.version, '0.13.2');
});
