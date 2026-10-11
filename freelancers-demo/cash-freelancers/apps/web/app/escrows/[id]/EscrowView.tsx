"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Dispute, Escrow, EscrowSummary } from "@cash-freelancers/shared";
import { api, ApiError } from "../../../lib/api";
import {
  ESCROW_STATUS_LABEL,
  ESCROW_MODE_LABEL,
  formatBch,
  truncateAddress,
  truncateTxid,
  escrowStatusTone
} from "../../../lib/format";
import { useAuth } from "../../providers/AuthProvider";
import { useWallet } from "../../providers/WalletProvider";
import { EmptyState, Notice, Pill, Spinner, StepList } from "../../components/ui";
import { EscrowActions, type ViewerRole } from "./EscrowActions";
import { DisputePanel, RulingPanel } from "./DisputePanel";

/**
 * The escrow screen: the state of the money, who is involved, and the one
 * action the current viewer is allowed to take.
 *
 * A client component because every route behind it needs the session, and
 * because the actions are wallet round-trips.
 */
export function EscrowView({ escrowId }: { escrowId: string }) {
  const { user, loading: authLoading } = useAuth();
  const [escrow, setEscrow] = useState<Escrow | null>(null);
  const [jobTitle, setJobTitle] = useState<string>("");
  const [parties, setParties] = useState<{ client: string; freelancer: string; arbiter?: string } | null>(
    null
  );
  // Null until the server has said which party the viewer is, and stays null
  // when the viewer is not one of the three. An action panel drawn on a guess
  // would offer a button the API is going to refuse, so nothing is drawn until
  // the role is known for certain.
  const [viewerRole, setViewerRole] = useState<ViewerRole | null>(null);
  const [dispute, setDispute] = useState<Dispute | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    let record: Escrow;
    try {
      record = await api.get<Escrow>(`/escrows/${escrowId}`);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Could not load this escrow. Is the API running?"
      );
      setLoading(false);
      return;
    }
    setEscrow(record);

    // The escrow record holds ids, not names, and there is no single "escrow
    // with parties" read. These follow-up lookups are therefore separate and
    // individually fault-tolerant: a missing display name must not stop the
    // user from seeing (or acting on) their money.
    const job = await api
      .get<{ title: string; clientId: string; freelancerId?: string }>(`/jobs/${record.jobId}`)
      .catch(() => null);
    setJobTitle(job?.title ?? "");

    // The viewer's role comes from the server, which derives it from the same
    // ids in the same query as the rest of the list. Re-deriving it here from
    // the job would be a second, weaker copy of an authorisation rule: a
    // missing job would silently default to "client", and anyone who is not the
    // client would fall through to "arbiter".
    const mine = await api.get<EscrowSummary[]>("/escrows/mine").catch(() => [] as EscrowSummary[]);
    setViewerRole(mine.find((e) => e.id === record.id)?.viewerRole ?? null);

    const [client, freelancer, arbiter, disputeRow] = await Promise.all([
      job ? api.get<{ displayName: string }>(`/users/${job.clientId}`).catch(() => null) : null,
      job?.freelancerId
        ? api.get<{ displayName: string }>(`/users/${job.freelancerId}`).catch(() => null)
        : null,
      record.arbiterId
        ? api.get<{ displayName: string }>(`/users/${record.arbiterId}`).catch(() => null)
        : null,
      api.get<Dispute>(`/escrows/${escrowId}/disputes`).catch(() => null)
    ]);

    setParties({
      client: client?.displayName ?? "Unknown",
      freelancer: freelancer?.displayName ?? "Unknown",
      arbiter: arbiter?.displayName
    });
    setDispute(disputeRow);
    setLoading(false);
  }, [escrowId]);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    void load();
  }, [user, load]);

  if (authLoading || loading) return <Spinner label="Loading escrow…" />;

  if (!user) {
    return (
      <Notice>
        Escrows are private. Connect a wallet and sign in to see this one.
      </Notice>
    );
  }

  if (error || !escrow) {
    return (
      <EmptyState title="Escrow unavailable">
        <p>{error ?? "Not found."}</p>
      </EmptyState>
    );
  }

  const currentStep = stepIndex(escrow);

  return (
    <div className="detail-grid">
      <div>
        <p className="eyebrow">
          <Link href="/dashboard" style={{ color: "inherit" }}>
            ← Your work
          </Link>
        </p>
        <h1>{jobTitle || "Escrow"}</h1>
        <div className="hero-actions" style={{ marginTop: 0, gap: 10 }}>
          <Pill tone={escrowStatusTone(escrow.status)}>{ESCROW_STATUS_LABEL[escrow.status]}</Pill>
          <Pill>{ESCROW_MODE_LABEL[escrow.mode]}</Pill>
        </div>

        <div className="card" style={{ marginTop: 26 }}>
          <div className="card-head">
            <div>
              <p className="label">In escrow</p>
              <p className="job">Held by the contract, not by either party</p>
            </div>
          </div>

          <p className="amount">{formatBch(escrow.amountSats)}</p>

          <hr className="divider" />

          <div className="row">
            <span>Client</span>
            <b>{parties?.client ?? "—"}</b>
          </div>
          <div className="row">
            <span>Freelancer</span>
            <b>{parties?.freelancer ?? "—"}</b>
          </div>
          {escrow.mode === "arbitrated" && (
            <div className="row">
              <span>Arbiter</span>
              <b>{parties?.arbiter ?? "—"}</b>
            </div>
          )}
          <div className="row">
            <span>Contract</span>
            <b className="mono" title={escrow.contractAddress}>
              {truncateAddress(escrow.contractAddress)}
            </b>
          </div>
          {escrow.fundingTxid && (
            <div className="row">
              <span>Funding tx</span>
              <b className="mono" title={escrow.fundingTxid}>
                {truncateTxid(escrow.fundingTxid)}
              </b>
            </div>
          )}
          {escrow.releaseTxid && (
            <div className="row">
              <span>Settlement tx</span>
              <b className="mono" title={escrow.releaseTxid}>
                {truncateTxid(escrow.releaseTxid)}
              </b>
            </div>
          )}
          {escrow.timeoutAt && (
            <div className="row">
              <span>Reclaimable after</span>
              <b>{new Date(escrow.timeoutAt).toLocaleDateString("en-US")}</b>
            </div>
          )}
        </div>

        {viewerRole && <EscrowActions escrow={escrow} viewerRole={viewerRole} onDone={load} />}

        {dispute && (
          <div className="card" style={{ marginTop: 22 }}>
            <div className="card-head">
              <div>
                <p className="label">Dispute</p>
                <p className="job">{dispute.status === "open" ? "Open" : "Resolved"}</p>
              </div>
              <Pill tone={dispute.status === "open" ? "danger" : "default"}>{dispute.status}</Pill>
            </div>
            <p style={{ fontSize: 14, color: "var(--muted)" }}>{dispute.reason}</p>
            {dispute.resolution && (
              <>
                <hr className="divider" />
                <p style={{ fontSize: 14 }}>
                  <b>Ruling:</b> {dispute.resolution}
                </p>
              </>
            )}
            {viewerRole === "arbiter" && <RulingPanel dispute={dispute} />}
          </div>
        )}

        {viewerRole && (
          <DisputePanel escrow={escrow} existing={dispute} onOpened={load} viewerRole={viewerRole} />
        )}
      </div>

      <aside className="sticky-side">
        <div className="card">
          <p className="label" style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>
            Progress
          </p>
          <StepList
            steps={["Contract created", "Funded", "Work delivered", "Settled"]}
            current={currentStep}
          />
        </div>
      </aside>
    </div>
  );
}

/**
 * Where the escrow is in the lifecycle, for the progress list. Settlement is
 * split by outcome because a refund is as final as a release.
 */
function stepIndex(escrow: Escrow): number {
  switch (escrow.status) {
    case "pending_funding":
      return 0;
    case "funded":
      return 1;
    case "disputed":
      return 2;
    case "released":
    case "refunded":
      return 4;
  }
}
