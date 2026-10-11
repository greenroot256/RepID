// Persistent retained state, backed by a JSON file.
//
// Node-only by construction: this is the one module allowed to import `node:`.
// The recognition core does not, which is what keeps it usable in a browser.
//
// The protocol requires that this state survive a restart -- otherwise a
// restart would make already-issued Rating Rights unfindable, and every rating
// after a restart would be unrecognized. The protocol does not care how the
// bytes are stored, so a SQLite or Postgres adapter is a legitimate
// substitution; this one exists because a JSON file is auditable by hand, which
// is worth a lot when a fact is disputed.
//
// Every mutation writes synchronously before returning. A store that acknowledges
// a track and loses it on the next crash produces facts that cannot be
// corroborated later, which is worse than a slower write.

import { readFileSync, writeFileSync } from 'node:fs';
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

interface PersistedState {
  ratingRights?: Record<string, RatingRightRecord>;
  receipts?: Record<string, ReceiptRecord>;
  identities?: Record<string, IdentityRecord>;
  ratings?: Record<string, RatingRecord>;
  retractions?: Record<string, RatingRecord>;
}

export interface JsonFileStore extends RepidStateStore {
  /** Forces a write. Useful at a controlled moment, and in tests. */
  save(): void;
}

export function createJsonFileStore(filePath: string): JsonFileStore {
  const ratingRights = new Map<Outpoint, RatingRightRecord>();
  const receipts = new Map<Txid, ReceiptRecord>();
  const identities = new Map<Outpoint, IdentityRecord>();
  const ratings = new Map<string, RatingRecord>();
  const retractions = new Map<string, RatingRecord>();

  const ratingKey = (raterPkh: string, receiptTxid: string) => `${raterPkh}:${receiptTxid}`;

  function load(): void {
    let raw: string;
    try {
      raw = readFileSync(filePath, 'utf8');
    } catch (err) {
      // A missing file is a first run, which is normal. Any other failure is a
      // real problem and must not be swallowed into a silently empty store:
      // starting empty would make every Rating Right unfindable and produce
      // facts that are wrong rather than missing.
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      return;
    }

    const data = JSON.parse(raw) as PersistedState;
    for (const [outpoint, record] of Object.entries(data.ratingRights ?? {})) {
      ratingRights.set(outpoint, record);
    }
    for (const [txid, record] of Object.entries(data.receipts ?? {})) {
      receipts.set(txid, record);
    }
    for (const [outpoint, record] of Object.entries(data.identities ?? {})) {
      identities.set(outpoint, record);
    }
    for (const [key, record] of Object.entries(data.ratings ?? {})) {
      ratings.set(key, record);
    }
    for (const [key, record] of Object.entries(data.retractions ?? {})) {
      retractions.set(key, record);
    }
  }

  function save(): void {
    const data: PersistedState = {
      ratingRights: Object.fromEntries(ratingRights),
      receipts: Object.fromEntries(receipts),
      identities: Object.fromEntries(identities),
      ratings: Object.fromEntries(ratings),
      retractions: Object.fromEntries(retractions),
    };
    writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  }

  load();

  return {
    getRatingRight(outpoint) {
      return ratingRights.get(outpoint);
    },
    trackRatingRight(outpoint, info) {
      ratingRights.set(outpoint, { outpoint, ...info });
      save();
    },
    consumeRatingRight(outpoint) {
      ratingRights.delete(outpoint);
      save();
    },
    getReceipt(txid) {
      return receipts.get(txid);
    },
    trackReceipt(txid, record) {
      receipts.set(txid, record);
      save();
    },
    hasRating(raterPkh, receiptTxid) {
      return ratings.has(ratingKey(raterPkh, receiptTxid));
    },
    recordRating(raterPkh, receiptTxid) {
      ratings.set(ratingKey(raterPkh, receiptTxid), { raterPkh, receiptTxid });
      save();
    },
    isRatingRetracted(raterPkh, receiptTxid) {
      return retractions.has(ratingKey(raterPkh, receiptTxid));
    },
    recordRatingRetraction(raterPkh, receiptTxid) {
      retractions.set(ratingKey(raterPkh, receiptTxid), { raterPkh, receiptTxid });
      save();
    },
    getIdentity(outpoint) {
      return identities.get(outpoint);
    },
    getIdentityByOwner(ownerPkh) {
      // Scanned, not indexed, for the same reason as the memory store: a second
      // map has to be kept in step by hand and can disagree with this one.
      for (const record of identities.values()) {
        if (record.ownerPkh === ownerPkh) return record;
      }
      return undefined;
    },
    trackIdentity(outpoint, record) {
      identities.set(outpoint, record);
      save();
    },
    untrackIdentity(outpoint) {
      identities.delete(outpoint);
      save();
    },
    save,
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

/** The on-disk shape, for callers that want to inspect or archive it. */
export type { RepidStateSnapshot };
