"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Job, Proposal } from "@cash-freelancers/shared";
import { api, ApiError } from "../../../lib/api";
import { useAuth } from "../../providers/AuthProvider";
import { Pill } from "../../components/ui";

/**
 * The client's accept/reject controls for one proposal.
 *
 * Accepting does two things, in this order, because the escrow needs both: the
 * proposal is marked accepted, and the freelancer is assigned to the job (which
 * is what puts them in `in_progress` and lets `POST /escrows` derive the
 * contract's three addresses). If the assignment fails after the proposal was
 * accepted, the error is surfaced instead of leaving a half-finished job.
 */
export function ProposalReview({ job, proposal }: { job: Job; proposal: Proposal }) {
  const router = useRouter();
  const { user } = useAuth();
  const [busy, setBusy] = useState<"accept" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (user?.id !== job.clientId) {
    return proposal.status === "accepted" ? <Pill>Accepted</Pill> : null;
  }

  if (proposal.status === "accepted") {
    return <Pill>Accepted</Pill>;
  }

  async function act(action: "accept" | "reject") {
    setBusy(action);
    setError(null);
    try {
      await api.post(`/proposals/${proposal.id}/${action}`);
      if (action === "accept") {
        await api.post(`/jobs/${job.id}/assign-freelancer`, { freelancerId: proposal.freelancerId });
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Could not ${action} this proposal`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          className="btn btn-line btn-sm"
          disabled={busy !== null}
          onClick={() => void act("reject")}
        >
          Decline
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={busy !== null}
          onClick={() => void act("accept")}
        >
          {busy === "accept" ? <span className="spinner" /> : "Accept"}
        </button>
      </div>
      {error && (
        <p className="field-error" style={{ maxWidth: 260, textAlign: "right" }}>
          {error}
        </p>
      )}
    </div>
  );
}
