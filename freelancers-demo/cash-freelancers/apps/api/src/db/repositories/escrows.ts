import { db } from "../client.js";
import type {
  Escrow,
  EscrowMode,
  EscrowStatus,
  EscrowSummary,
  JobStatus
} from "@cash-freelancers/shared";
import { createEscrowBilateralContract, createEscrowArbitratedContract } from "@cash-freelancers/contracts";
import { pkhFromAddress } from "../../utils/address.js";
import { network } from "../../config.js";
import { findJobById } from "./jobs.js";
import { findUserById } from "./users.js";

interface EscrowRow {
  id: string;
  job_id: string;
  mode: EscrowMode;
  contract_address: string;
  amount_sats: string;
  status: EscrowStatus;
  arbiter_id: string | null;
  funding_txid: string | null;
  release_txid: string | null;
  timeout_at: Date | null;
  pending_signature_hex: string | null;
  pending_signature_by: string | null;
  pending_outcome: "release" | "refund" | null;
  client_wallet_address: string;
  freelancer_wallet_address: string;
  arbiter_wallet_address: string | null;
  created_at: Date;
  updated_at: Date;
}

/** The extra columns `listEscrowsForUser` joins in. */
interface EscrowSummaryRow {
  job_title: string;
  job_status: JobStatus;
  viewer_role: "client" | "freelancer" | "arbiter";
}

function mapEscrow(row: EscrowRow): Escrow {
  return {
    id: row.id,
    jobId: row.job_id,
    mode: row.mode,
    contractAddress: row.contract_address,
    arbiterId: row.arbiter_id ?? undefined,
    amountSats: Number(row.amount_sats),
    status: row.status,
    fundingTxid: row.funding_txid ?? undefined,
    releaseTxid: row.release_txid ?? undefined,
    timeoutAt: row.timeout_at?.toISOString(),
    clientWalletAddress: row.client_wallet_address,
    freelancerWalletAddress: row.freelancer_wallet_address,
    arbiterWalletAddress: row.arbiter_wallet_address ?? undefined
  };
}

/**
 * The wallet an account will use for a new escrow: its active one.
 *
 * Read straight from the column rather than through `User.walletAddress`,
 * which is still the pre-multi-wallet single wallet. Once the user repository
 * maps `wallets`/`activeRole` this can go through the shared `User` type.
 */
async function findActiveWalletAddress(userId: string): Promise<string> {
  const { rows } = await db.query<{ active_wallet_address: string | null }>(
    "SELECT active_wallet_address FROM users WHERE id = $1",
    [userId]
  );
  const address = rows[0]?.active_wallet_address;
  if (!address) {
    throw new Error(`User ${userId} has no active wallet, so an escrow cannot be created for them`);
  }
  return address;
}

/**
 * Creates an escrow for a job. Not a pure CRUD wrapper: it looks up the
 * job's client/freelancer (and arbiter, in arbitrated mode) to derive
 * their pkh from their wallet address and instantiate the real
 * on-chain contract, so `contract_address` is always the actual
 * covenant address, never something the caller has to compute and pass
 * in themselves.
 */
export async function createEscrow(input: {
  jobId: string;
  mode: EscrowMode;
  amountSats: number;
  arbiterId?: string;
  timeoutAt?: Date; // required for "bilateral", ignored for "arbitrated"
}): Promise<Escrow> {
  const job = await findJobById(input.jobId);
  if (!job) throw new Error(`Job ${input.jobId} not found`);
  if (!job.freelancerId) throw new Error(`Job ${input.jobId} has no freelancer assigned yet`);

  const [client, freelancer] = await Promise.all([
    findUserById(job.clientId),
    findUserById(job.freelancerId)
  ]);
  if (!client) throw new Error(`Client ${job.clientId} not found`);
  if (!freelancer) throw new Error(`Freelancer ${job.freelancerId} not found`);

  // The wallets are captured here, once, and written to the escrow. From
  // this point on the escrow's covenant is locked to these public key hashes:
  // if a party later activates a different wallet, this escrow still has to
  // be signed by the address stored here, and the parties stay reachable
  // through it even if they lose the key that opened it.
  const [clientWallet, freelancerWallet, arbiterWallet] = await Promise.all([
    findActiveWalletAddress(job.clientId),
    findActiveWalletAddress(job.freelancerId),
    input.arbiterId ? findActiveWalletAddress(input.arbiterId) : Promise.resolve(undefined)
  ]);

  let contractAddress: string;

  if (input.mode === "bilateral") {
    if (!input.timeoutAt) throw new Error("timeoutAt is required for a bilateral escrow");
    const contract = createEscrowBilateralContract({
      clientPkh: pkhFromAddress(clientWallet),
      freelancerPkh: pkhFromAddress(freelancerWallet),
      timeout: BigInt(Math.floor(input.timeoutAt.getTime() / 1000)),
      network
    });
    contractAddress = contract.address;
  } else {
    if (!input.arbiterId) throw new Error("arbiterId is required for an arbitrated escrow");
    if (!arbiterWallet) throw new Error(`Arbiter ${input.arbiterId} has no active wallet`);
    const contract = createEscrowArbitratedContract({
      clientPkh: pkhFromAddress(clientWallet),
      freelancerPkh: pkhFromAddress(freelancerWallet),
      arbiterPkh: pkhFromAddress(arbiterWallet),
      network
    });
    contractAddress = contract.address;
  }

  const { rows } = await db.query<EscrowRow>(
    `INSERT INTO escrows (
       job_id, mode, contract_address, amount_sats, arbiter_id, timeout_at,
       client_wallet_address, freelancer_wallet_address, arbiter_wallet_address
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [
      input.jobId,
      input.mode,
      contractAddress,
      input.amountSats,
      input.arbiterId ?? null,
      input.timeoutAt ?? null,
      clientWallet,
      freelancerWallet,
      arbiterWallet ?? null
    ]
  );
  return mapEscrow(rows[0]);
}

export async function findEscrowById(id: string): Promise<Escrow | undefined> {
  const { rows } = await db.query<EscrowRow>("SELECT * FROM escrows WHERE id = $1", [id]);
  return rows[0] ? mapEscrow(rows[0]) : undefined;
}

export async function findEscrowByJobId(jobId: string): Promise<Escrow | undefined> {
  const { rows } = await db.query<EscrowRow>("SELECT * FROM escrows WHERE job_id = $1", [jobId]);
  return rows[0] ? mapEscrow(rows[0]) : undefined;
}

/**
 * Every escrow the user is a party to, as client, freelancer or arbiter, joined
 * with the job's title and status.
 *
 * `viewer_role` is computed in SQL with a CASE chain rather than in JS: the
 * caller needs it to decide which buttons to render, and a role that the API
 * and the UI could disagree about is exactly the kind of mismatch that produces
 * a 403 the user cannot explain. Client wins over freelancer over arbiter when
 * a user somehow holds more than one role, so the most privileged view wins.
 */
export async function listEscrowsForUser(userId: string): Promise<EscrowSummary[]> {
  const { rows } = await db.query<EscrowRow & EscrowSummaryRow>(
    `SELECT e.*,
            j.title AS job_title,
            j.status AS job_status,
            CASE
              WHEN j.client_id = $1 THEN 'client'
              WHEN j.freelancer_id = $1 THEN 'freelancer'
              ELSE 'arbiter'
            END AS viewer_role
       FROM escrows e
       JOIN jobs j ON j.id = e.job_id
      WHERE j.client_id = $1 OR j.freelancer_id = $1 OR e.arbiter_id = $1
      ORDER BY e.updated_at DESC`,
    [userId]
  );
  return rows.map((row) => ({
    ...mapEscrow(row),
    jobTitle: row.job_title,
    jobStatus: row.job_status,
    viewerRole: row.viewer_role
  }));
}

export async function updateEscrowStatus(id: string, status: EscrowStatus): Promise<Escrow | undefined> {
  const { rows } = await db.query<EscrowRow>(
    "UPDATE escrows SET status = $2, updated_at = now() WHERE id = $1 RETURNING *",
    [id, status]
  );
  return rows[0] ? mapEscrow(rows[0]) : undefined;
}

/**
 * Marks an escrow funded, but only from `pending_funding`.
 *
 * The status guard is in the WHERE clause rather than a prior SELECT so that
 * it is enforced atomically. Without it, two concurrent funding requests (or a
 * retry after a timeout) could both "succeed" and the second would silently
 * overwrite the first funding txid, leaving the DB pointing at a transaction
 * that no longer holds any of the escrowed money.
 */
export async function markFunded(id: string, fundingTxid: string): Promise<Escrow | undefined> {
  const { rows } = await db.query<EscrowRow>(
    `UPDATE escrows SET status = 'funded', funding_txid = $2, updated_at = now()
     WHERE id = $1 AND status = 'pending_funding' RETURNING *`,
    [id, fundingTxid]
  );
  if (rows.length === 0) {
    throw new Error(
      `Escrow ${id} is not in pending_funding, so it cannot be marked funded. ` +
        `It was probably already settled.`
    );
  }
  return mapEscrow(rows[0]);
}

/** Step 1 of the two-step co-signing flow: persists the first
 *  co-signer's partially-signed transaction until the second co-signer
 *  is ready. See startTwoPartySignature/completeTwoPartySignature in
 *  @cash-freelancers/wallet-connect. */
export async function savePendingSignature(input: {
  escrowId: string;
  signedTransactionHex: string;
  signedBy: string;
  outcome: "release" | "refund";
}): Promise<void> {
  await db.query(
    `UPDATE escrows
     SET pending_signature_hex = $2, pending_signature_by = $3, pending_outcome = $4, updated_at = now()
     WHERE id = $1`,
    [input.escrowId, input.signedTransactionHex, input.signedBy, input.outcome]
  );
}

export async function getPendingSignature(escrowId: string): Promise<
  { signedTransactionHex: string; signedBy: string; outcome: "release" | "refund" } | undefined
> {
  const { rows } = await db.query<{
    pending_signature_hex: string | null;
    pending_signature_by: string | null;
    pending_outcome: "release" | "refund" | null;
  }>(
    "SELECT pending_signature_hex, pending_signature_by, pending_outcome FROM escrows WHERE id = $1",
    [escrowId]
  );
  const row = rows[0];
  if (!row?.pending_signature_hex || !row.pending_signature_by || !row.pending_outcome) {
    return undefined;
  }
  return {
    signedTransactionHex: row.pending_signature_hex,
    signedBy: row.pending_signature_by,
    outcome: row.pending_outcome
  };
}

/** Step 2 done, on-chain settlement verified by the caller: records the real
 *  broadcast txid, sets the escrow's final status (`released`/`refunded`)
 *  based on the outcome stored in step 1, and clears the pending-signature
 *  fields.
 *
 *  Guarded on `status = 'funded'` for the same reason as `markFunded`: the
 *  settled amount and the recorded txid have to correspond to the one funding
 *  output that was actually verified. */
export async function finalizeEscrow(input: {
  escrowId: string;
  outcome: "release" | "refund";
  releaseTxid: string;
}): Promise<Escrow | undefined> {
  const status: EscrowStatus = input.outcome === "release" ? "released" : "refunded";
  const { rows } = await db.query<EscrowRow>(
    `UPDATE escrows
     SET status = $2, release_txid = $3,
         pending_signature_hex = NULL, pending_signature_by = NULL, pending_outcome = NULL,
         updated_at = now()
     WHERE id = $1 AND status = 'funded' RETURNING *`,
    [input.escrowId, status, input.releaseTxid]
  );
  if (rows.length === 0) {
    throw new Error(
      `Escrow ${input.escrowId} is not in funded, so it cannot be settled. ` +
        `It may have already been settled.`
    );
  }
  return mapEscrow(rows[0]);
}
