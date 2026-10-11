// In-memory retained state.
//
// Isomorphic on purpose: nothing here imports from `node:`, so a browser can
// recognize facts and keep the required state for a session. Only persistence
// needs a filesystem, and that lives behind a separate entry point.
//
// The maps are the whole state. There is no cache and no derived index, because
// a derived value that can disagree with the thing it was derived from is a bug
// waiting to happen.

import type {
  IdentityRecord,
  Outpoint,
  RatingRecord,
  RatingRightRecord,
  ReceiptRecord,
  RepidStateSnapshot,
  RepidStateStore,
  Txid,
} from '../types.js';

export function createMemoryStore(): RepidStateStore {
  const ratingRights = new Map<Outpoint, RatingRightRecord>();
  const receipts = new Map<Txid, ReceiptRecord>();
  const identities = new Map<Outpoint, IdentityRecord>();
  const ratings = new Map<string, RatingRecord>();
  const retractions = new Map<string, RatingRecord>();

  // The retention key of the ratings index and the retracted set: one entry per
  // rater-and-Receipt, which is how a retraction is corroborated and how two
  // parties rating the same Receipt are kept independent.
  const ratingKey = (raterPkh: string, receiptTxid: string) => `${raterPkh}:${receiptTxid}`;

  return {
    getRatingRight(outpoint) {
      return ratingRights.get(outpoint);
    },
    trackRatingRight(outpoint, info) {
      ratingRights.set(outpoint, { outpoint, ...info });
    },
    consumeRatingRight(outpoint) {
      ratingRights.delete(outpoint);
    },
    getReceipt(txid) {
      return receipts.get(txid);
    },
    trackReceipt(txid, record) {
      receipts.set(txid, record);
    },
    hasRating(raterPkh, receiptTxid) {
      return ratings.has(ratingKey(raterPkh, receiptTxid));
    },
    recordRating(raterPkh, receiptTxid) {
      ratings.set(ratingKey(raterPkh, receiptTxid), { raterPkh, receiptTxid });
    },
    isRatingRetracted(raterPkh, receiptTxid) {
      return retractions.has(ratingKey(raterPkh, receiptTxid));
    },
    recordRatingRetraction(raterPkh, receiptTxid) {
      retractions.set(ratingKey(raterPkh, receiptTxid), { raterPkh, receiptTxid });
    },
    getIdentity(outpoint) {
      return identities.get(outpoint);
    },
    getIdentityByOwner(ownerPkh) {
      // A linear scan, and deliberately not a second map. An index would have to
      // be kept in step with `identities` by hand, and the bug it invites is
      // invisible: the store would report an identity it no longer tracks. The
      // number of live identities is small enough that scanning is cheaper than
      // that risk.
      for (const record of identities.values()) {
        if (record.ownerPkh === ownerPkh) return record;
      }
      return undefined;
    },
    trackIdentity(outpoint, record) {
      identities.set(outpoint, record);
    },
    untrackIdentity(outpoint) {
      identities.delete(outpoint);
    },
    snapshot() {
      return {
        ratingRights: [...ratingRights.entries()],
        receipts: [...receipts.entries()],
        identities: [...identities.entries()],
        ratings: [...ratings.entries()],
        retractions: [...retractions.entries()],
      };
    },
  };
}
