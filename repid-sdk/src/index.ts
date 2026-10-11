// Public surface of the SDK.
//
// Nothing in this import graph touches `node:`, so the whole recognition core
// can run in a browser or a worker. The filesystem-backed store is deliberately
// a separate entry point (`@repid/sdk/node`) so importing this one does not drag
// a Node-only dependency into a browser bundle.

export { indexRawTransaction } from './recognize.js';
export { createMemoryStore } from './state/memory-store.js';

export {
  OP_RETURN_TAGS,
  MIN_SCORE,
  MAX_SCORE,
  ENCODED_SCORE_RANGE,
  FIELD_BYTE_LENGTHS,
  FIELD_HEX_LENGTHS,
  FACT_TYPES,
  PROTOCOL_NAME,
  PROTOCOL_VERSION,
  PROTOCOL_STATUS,
  PROTOCOL_SPECIFICATION,
  isFactType,
  type OpReturnTagKey,
} from './constants.js';

export { hexToBytes, parseOpReturn, toHex } from './bytes.js';
export { decodeRawTransaction, type DecodedTransaction } from './transaction.js';

// Covenant binding is exposed but not applied by `indexRawTransaction`: base
// recognition stays shape-based, and binding is a separate, opt-in step. See the
// module header for why the comparison is exact and what it does not cover.
export {
  readP2SHHash,
  readRedeemScript,
  findFinalPush,
  buildExpectedScript,
  buildP2SH32Hash,
  verifyVaultOutputBinding,
  verifyRedeemScriptBinding,
  type BindingFailure,
  type BindingResult,
  type CanonicalCovenant,
  type ConstructorInput,
} from './covenant.js';

export {
  SDK_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
  assertSupportsProtocolVersion,
} from './version.js';

export type {
  AmountString,
  Category,
  FactType,
  IdentityBurnedFact,
  IdentityCollateralTopUpFact,
  IdentityGenesisFact,
  IdentityRecord,
  Outpoint,
  Pkh,
  PlatformConfirmationFact,
  RatingIssuedFact,
  RatingRecord,
  RatingRetractionFact,
  RatingRightInfo,
  RatingRightRecord,
  ReceiptContext,
  ReceiptGenesisFact,
  ReceiptRecord,
  RepidFact,
  RepidStateSnapshot,
  RepidStateStore,
  TrustLinkFact,
  Txid,
  ValidatedFact,
} from './types.js';
