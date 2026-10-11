import type { EscrowStatus, EscrowMode, JobStatus } from "@cash-freelancers/shared";

/**
 * Satoshis to BCH. Four decimals matches the precision the reference design
 * shows, and every amount in the product is a whole number of satoshis, so
 * trailing-zero trimming keeps "0.31 BCH" from rendering as "0.3100 BCH".
 */
export function satsToBch(sats: number | bigint, decimals = 4): string {
  const bch = Number(sats) / 1e8;
  return bch.toFixed(decimals).replace(/\.?0+$/, "");
}

export function formatBch(sats: number | bigint, decimals = 4): string {
  return `${satsToBch(sats, decimals)} BCH`;
}

/**
 * BCH to satoshis without float arithmetic.
 *
 * Amounts are entered in BCH because that is how people think about them, but
 * the API stores whole satoshis. Going through `Number(whole) * 1e8 +
 * Number(fraction)` would turn 0.1 BCH into 9999999 sats, so the fractional
 * part is padded to exactly 8 digits and the sum is checked for safety.
 *
 * Returns null for anything that is not a plain decimal amount, so callers can
 * treat a typo as "not entered" instead of funding a nonsense amount.
 */
export function bchToSats(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "." || !/^\d*(\.\d*)?$/.test(trimmed)) return null;

  const [whole = "0", fraction = ""] = trimmed.split(".");
  if (fraction.length > 8) return null;

  const sats = Number(whole) * 1e8 + Number(fraction.padEnd(8, "0"));
  return Number.isSafeInteger(sats) ? sats : null;
}

export function formatUsd(usd: number | null): string | null {  if (usd === null || !Number.isFinite(usd)) return null;
  // Grouped thousands and exactly two decimals: a rough fiat figure is a
  // courtesy, not an accounting statement.
  return `$${usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Cash addresses are long and share a prefix, so a useful truncation shows the
 * tail. `bcrt1…8f3k` style keeps both ends recognisable.
 */
export function truncateAddress(address: string, lead = 10, tail = 6): string {
  if (!address) return "";
  if (address.length <= lead + tail + 1) return address;
  return `${address.slice(0, lead)}…${address.slice(-tail)}`;
}

export function truncateTxid(txid: string, lead = 10, tail = 6): string {
  return truncateAddress(txid, lead, tail);
}

/** Explorers take the txid, so a single helper avoids five hard-coded URLs. */
export function explorerTxUrl(base: string | undefined, txid: string): string | null {
  if (!base) return null;
  return `${base.replace(/\/$/, "")}/tx/${txid}`;
}

export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  delivered: "Delivered",
  completed: "Completed",
  cancelled: "Cancelled"
};

export const ESCROW_STATUS_LABEL: Record<EscrowStatus, string> = {
  pending_funding: "Awaiting funding",
  funded: "Funded",
  released: "Released",
  refunded: "Refunded",
  disputed: "Disputed"
};

export const ESCROW_MODE_LABEL: Record<EscrowMode, string> = {
  bilateral: "2-party escrow",
  arbitrated: "3-party escrow"
};

/** Mirrors the API's SETTLEMENT_RULES so the UI never offers a rejected action. */
export type SettlementPurpose =
  | "funding"
  | "release"
  | "reclaim"
  | "arbitrated-release"
  | "arbitrated-refund";

export function escrowStatusTone(status: EscrowStatus): "default" | "warn" | "danger" {
  if (status === "pending_funding") return "warn";
  if (status === "disputed") return "danger";
  return "default";
}

export function jobStatusTone(status: JobStatus): "default" | "warn" | "danger" {
  if (status === "open") return "default";
  if (status === "cancelled") return "danger";
  return "warn";
}
