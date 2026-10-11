import type { JobStatus } from "./job.js";
import type { UserRole } from "./user.js";

export type EscrowMode = "bilateral" | "arbitrated";

export type EscrowStatus =
  | "pending_funding"
  | "funded"
  | "released"
  | "refunded"
  | "disputed";

export interface Escrow {
  id: string;
  jobId: string;
  mode: EscrowMode;
  contractAddress: string;
  arbiterId?: string;
  amountSats: number;
  status: EscrowStatus;
  fundingTxid?: string;
  releaseTxid?: string;
  timeoutAt?: string;

  /**
   * The wallet addresses this escrow is bound to, frozen when it was created.
   *
   * These are not the parties' current active wallets. The covenant's public
   * key hashes are derived from them at funding time and cannot change
   * afterwards, so an account that later switches its active wallet is still
   * bound here to the old one. The UI needs them to tell a user why signing
   * failed: the connected wallet has to be this one, not whatever is active.
   */
  clientWalletAddress: string;
  freelancerWalletAddress: string;
  arbiterWalletAddress?: string;
}

/**
 * An escrow joined with just enough of its job to be renderable in a list
 * (the dashboard). `Escrow` alone is unusable there: a row of ids and amounts
 * is not something a user can act on.
 */
export interface EscrowSummary extends Escrow {
  jobTitle: string;
  jobStatus: JobStatus;
  /**
   * The role the authenticated user actually holds in this escrow, resolved
   * from the job's client_id/freelancer_id. This is the fact the role gate
   * compares `User.activeRole` against, and it is per-escrow on purpose — a
   * user is the client of one escrow and the freelancer of another.
   */
  viewerRole: UserRole;
}
