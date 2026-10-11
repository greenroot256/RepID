// Conformance validator for RepID facts.
//
// Two layers, deliberately separated:
//
//   structural - JSON Schema (protocol/schemas/repid-fact.schema.json).
//               Field presence, types, hex formats, closed field sets.
//   semantic   - cross-field rules that JSON Schema cannot express, such as
//               `trusterPkh != trustedPkh` and `collateral >= previousCollateral`.
//
// Separating them matters for honesty: a fact that passes the schema can still
// be invalid, and we do not want a schema pass to be mistaken for a valid fact.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

export const constants = JSON.parse(
  readFileSync(join(root, 'protocol', 'constants.json'), 'utf8'),
);
export const protocolVersion = JSON.parse(
  readFileSync(join(root, 'protocol', 'protocol-version.json'), 'utf8'),
);
const schema = JSON.parse(
  readFileSync(join(root, 'protocol', 'schemas', 'repid-fact.schema.json'), 'utf8'),
);

// Strict mode is on deliberately. It refuses to compile a schema whose rules are
// ambiguous or silently ineffective, such as a `maximum` applied to a value whose
// type was never declared -- a rule that would accept a string where a number was
// meant without ever complaining. A normative schema that no strict validator can
// compile is a defect, and it is cheaper to find it here than in an implementation.
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateSchema = ajv.compile(schema);

// Annotations added by an application layer, not by the protocol. A recognizer
// MUST ignore them and MUST NOT interpret them as part of the fact.
const APP_ANNOTATIONS = new Set(['at', 'roles', 'note']);

export function splitAnnotations(fact) {
  const annotations = {};
  const protocolFact = {};
  for (const [key, value] of Object.entries(fact)) {
    if (APP_ANNOTATIONS.has(key)) annotations[key] = value;
    else protocolFact[key] = value;
  }
  return { protocolFact, annotations };
}

export function structuralErrors(fact) {
  if (validateSchema(fact)) return [];
  return validateSchema.errors.map((e) => ({
    path: e.instancePath || '/',
    keyword: e.keyword,
    message: e.message,
  }));
}

export function semanticErrors(fact) {
  const errors = [];
  const { MIN_SCORE, MAX_SCORE } = constants.scoreRange;

  switch (fact.type) {
    case 'RATING_ISSUED':
      if (fact.valid && (fact.score < MIN_SCORE || fact.score > MAX_SCORE)) {
        errors.push({
          rule: 'SPEC-004 RF-04',
          message: `valid rating carries score ${fact.score}, outside ${MIN_SCORE}..${MAX_SCORE}`,
        });
      }
      break;

    case 'TRUST_LINK':
      if (fact.valid && fact.trusterPkh === fact.trustedPkh) {
        errors.push({ rule: 'SPEC-006 RF-04', message: 'self-trust cannot be valid' });
      }
      break;

    case 'IDENTITY_COLLATERAL_TOP_UP':
      if (
        fact.valid &&
        BigInt(fact.collateral) < BigInt(fact.previousCollateral)
      ) {
        errors.push({
          rule: 'SPEC-001',
          message: `collateral decreased (${fact.previousCollateral} -> ${fact.collateral})`,
        });
      }
      break;

    case 'IDENTITY_GENESIS':
      // Vault and legacy forms differ. Collateral in a legacy form would be
      // meaningless: the legacy genesis locks no value.
      if ('collateral' in fact) {
        const n = BigInt(fact.collateral);
        if (n <= 0n) {
          errors.push({
            rule: 'SPEC-001',
            message: 'vault form requires a positive collateral',
          });
        }
      }
      break;

    // These three carry no rule the schema or this layer can add: the burn is
    // valid by the fact of the category disappearing, the confirmation's and
    // the retraction's validity are decided by the index at recognition time
    // (the referenced Receipt: PLATFORM_CONFIRMATION SPEC-003 RF-10;
    // RATING_RETRACTION SPEC-004 RF-07).
    case 'IDENTITY_BURNED':
    case 'PLATFORM_CONFIRMATION':
    case 'RATING_RETRACTION':
      break;

    case 'RECEIPT_GENESIS': {
      const [a, b] = fact.ratingRights ?? [];
      if (a && b) {
        if (a.ownerPkh === b.ownerPkh) {
          errors.push({ rule: 'SPEC-003', message: 'both Rating Rights have the same holder' });
        }
        if (a.ratesPkh !== b.ownerPkh || b.ratesPkh !== a.ownerPkh) {
          errors.push({
            rule: 'SPEC-003',
            message: 'Rating Rights must cross-reference each other',
          });
        }
      }
      break;
    }

    default: {
      // Only a type the protocol never declared is an error here. A declared
      // type with no extra rule falls through its own case, not this one.
      const known = constants.factTypes.some((t) => t.type === fact.type);
      errors.push(
        known
          ? { rule: 'SPEC-008 §3', message: `${fact.type} has no semantic checks` }
          : { rule: 'SPEC-008 §3', message: `unknown fact type: ${fact.type}` },
      );
    }
  }

  return errors;
}

export function validateFact(rawFact) {
  const { protocolFact, annotations } = splitAnnotations(rawFact);
  const structural = structuralErrors(protocolFact);
  // Semantic checks assume a structurally sound fact and may read fields that
  // a malformed fact simply does not have, so they run only once the shape is
  // known good. validateFact is not the place to accumulate every possible
  // complaint; callers that need a full audit of a broken fact should call
  // structuralErrors and semanticErrors separately.
  const semantic = structural.length === 0 ? semanticErrors(protocolFact) : [];
  return {
    ok: structural.length === 0 && semantic.length === 0,
    structural,
    semantic,
    annotations,
  };
}
