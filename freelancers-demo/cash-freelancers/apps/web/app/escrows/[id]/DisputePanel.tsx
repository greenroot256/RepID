"use client";

import { useState } from "react";
import type { Dispute, Escrow } from "@cash-freelancers/shared";
import { api, ApiError } from "../../../lib/api";
import { Field, Notice } from "../../components/ui";
import type { ViewerRole } from "./EscrowActions";

/**
 * Opens a dispute on a funded escrow, and — if the viewer happens to be the
 * escrow's arbiter — records the written ruling that goes with it.
 *
 * Two different jobs, so two forms: the API only lets a client or freelancer
 * open a dispute, and only the escrow's arbiter resolve one. A single combined
 * form would show most users a button that is guaranteed to 403.
 */
export function DisputePanel({
  escrow,
  existing,
  onOpened,
  viewerRole
}: {
  escrow: Escrow;
  existing: Dispute | null;
  onOpened: () => Promise<void>;
  viewerRole: ViewerRole;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // The arbiter is a third party to the disagreement, so a dispute is theirs
  // to rule on, not theirs to open.
  const canDispute =
    escrow.status === "funded" && !existing && viewerRole !== "arbiter";
  if (!canDispute) return null;

  async function submitDispute(event: React.FormEvent) {
    event.preventDefault();
    setBusy("dispute");
    setError(null);
    try {
      await api.post<Dispute>(`/escrows/${escrow.id}/disputes`, { reason: reason.trim() });
      setOpen(false);
      await onOpened();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not open the dispute");
    } finally {
      setBusy(null);
    }
  }

  if (!open) {
    return (
      <div className="card" style={{ marginTop: 22 }}>
        <h3 style={{ fontSize: 17, marginBottom: 8 }}>Something wrong?</h3>
        <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 16 }}>
          Opening a dispute flags the escrow for review. The money does not move until it is resolved.
        </p>
        <button type="button" className="btn btn-danger btn-block" onClick={() => setOpen(true)}>
          Open a dispute
        </button>
      </div>
    );
  }

  return (
    <form className="card" style={{ marginTop: 22 }} onSubmit={submitDispute} noValidate>
      <h3 style={{ fontSize: 17, marginBottom: 14 }}>Open a dispute</h3>

      <Field label="What happened?" hint="Both parties and the arbiter read this. Be specific.">
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={4} maxLength={2000} />
      </Field>

      {error && <p className="field-error" style={{ marginTop: 12 }}>{error}</p>}

      <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
        <button
          type="submit"
          className="btn btn-danger"
          disabled={busy !== null || reason.trim().length < 10}
        >
          {busy === "dispute" ? <span className="spinner" /> : "Open dispute"}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** The arbiter's ruling, shown only on a dispute that is still open. */
export function RulingPanel({ dispute }: { dispute: Dispute }) {
  const [resolution, setResolution] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  if (dispute.status !== "open" || done) return null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post<Dispute>(`/disputes/${dispute.id}/resolve`, { resolution: resolution.trim() });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not record the ruling");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ marginTop: 18 }}>
      <Notice tone="warn">
        Your ruling is recorded here. Moving the money is a separate two-of-three co-signature, so the
        text alone does not settle the escrow.
      </Notice>

      <div style={{ marginTop: 14 }}>
        <Field label="Ruling">
          <textarea value={resolution} onChange={(e) => setResolution(e.target.value)} rows={3} maxLength={1000} />
        </Field>
      </div>

      {error && <p className="field-error" style={{ marginTop: 12 }}>{error}</p>}

      <button
        type="submit"
        className="btn btn-primary"
        style={{ marginTop: 14 }}
        disabled={busy || resolution.trim().length < 5}
      >
        {busy ? <span className="spinner" /> : "Record ruling"}
      </button>
    </form>
  );
}
