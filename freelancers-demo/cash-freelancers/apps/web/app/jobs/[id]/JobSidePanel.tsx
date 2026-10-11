"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { EscrowSummary, Job } from "@cash-freelancers/shared";
import { api, ApiError } from "../../../lib/api";
import { bchToSats } from "../../../lib/format";
import { useAuth } from "../../providers/AuthProvider";
import { Notice, Spinner } from "../../components/ui";

/**
 * The client-side of the job page: who the viewer is, and therefore which of
 * the four jobs-view states they are looking at (browse, apply, waiting, or
 * open the escrow).
 *
 * The role is decided here from the authenticated user and the job, not taken
 * from the server, because the job itself is public. The API re-checks
 * everything — this only decides what to draw.
 */
export function JobSidePanel({ job }: { job: Job }) {
  const { user, loading } = useAuth();
  const [escrows, setEscrows] = useState<EscrowSummary[] | null>(null);

  const isClient = user?.id === job.clientId;
  const isFreelancer = user?.id === job.freelancerId;
  const existing = escrows?.find((e) => e.jobId === job.id) ?? null;

  // Only the client can open an escrow for the job, so only the client needs
  // the lookup that tells us whether one already exists.
  useEffect(() => {
    if (!isClient) {
      setEscrows(null);
      return;
    }
    let cancelled = false;
    api
      .get<EscrowSummary[]>("/escrows/mine")
      .then((rows) => {
        if (!cancelled) setEscrows(rows);
      })
      .catch(() => {
        if (!cancelled) setEscrows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isClient]);

  if (loading) return null;

  if (!user) {
    return (
      <div className="card" style={{ marginTop: 20 }}>
        <Notice>Connect a wallet and sign in to send a proposal.</Notice>
      </div>
    );
  }

  if (isClient && existing) {
    return (
      <div className="card" style={{ marginTop: 20 }}>
        <p className="label" style={{ fontSize: 13, color: "var(--muted)" }}>
          Escrow
        </p>
        <p style={{ fontWeight: 500, marginTop: 4 }}>{existing.status.replace("_", " ")}</p>
        <Link href={`/escrows/${existing.id}`} className="btn btn-primary btn-block" style={{ marginTop: 16 }}>
          Open escrow
        </Link>
      </div>
    );
  }

  if (isClient) {
    if (!job.freelancerId) {
      return (
        <div className="card" style={{ marginTop: 20 }}>
          <Notice>
            Accept a proposal to assign a freelancer. You can fund the escrow as soon as you have.
          </Notice>
        </div>
      );
    }
    if (escrows === null) {
      return (
        <div className="card" style={{ marginTop: 20 }}>
          <Spinner label="Checking for an escrow…" />
        </div>
      );
    }
    return <OpenEscrowPanel job={job} />;
  }

  if (isFreelancer) {
    return (
      <div className="card" style={{ marginTop: 20 }}>
        <Notice tone="warn">
          You are the freelancer on this job. The client funds the escrow before you start.
        </Notice>
      </div>
    );
  }

  return (
    <div className="card" style={{ marginTop: 20 }}>
      <p style={{ color: "var(--muted)", fontSize: 14 }}>
        {job.status === "open" ? "This job is open for proposals." : `This job is ${job.status.replace("_", " ")}.`}
      </p>
    </div>
  );
}

type Arbiter = { userId: string; feeBps: number; disputesResolved: number; displayName?: string };

/**
 * Creates the escrow. The contract address is derived server-side from the
 * three parties, so the browser only sends the terms the two sides agreed on.
 */
function OpenEscrowPanel({ job }: { job: Job }) {
  const [mode, setMode] = useState<"bilateral" | "arbitrated">(
    job.preferredMode ?? "bilateral"
  );
  const [bch, setBch] = useState((job.budgetSats / 1e8).toFixed(4));
  const [days, setDays] = useState(14);
  const [arbiters, setArbiters] = useState<Arbiter[] | null>(null);
  const [arbiterId, setArbiterId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== "arbitrated" || arbiters !== null) return;
    let cancelled = false;
    api
      .get<Arbiter[]>("/arbiters")
      .then((rows) => {
        if (cancelled) return;
        setArbiters(rows);
        if (rows[0]) setArbiterId(rows[0].userId);
      })
      .catch(() => {
        if (!cancelled) setArbiters([]);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, arbiters]);

  const sats = bchToSats(bch);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const escrow = await api.post<{ id: string }>("/escrows", {
        jobId: job.id,
        mode,
        amountSats: sats,
        // A bilateral escrow's nLockTime is the only thing standing between a
        // stalled job and money stuck forever, so it is never left implicit.
        ...(mode === "bilateral"
          ? { timeoutAt: new Date(Date.now() + days * 86_400_000).toISOString() }
          : { arbiterId })
      });
      setCreatedId(escrow.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the escrow");
    } finally {
      setBusy(false);
    }
  }

  if (createdId) {
    return (
      <div className="card" style={{ marginTop: 20 }}>
        <Notice>The escrow contract exists. Fund it to lock the money in.</Notice>
        <Link href={`/escrows/${createdId}`} className="btn btn-primary btn-block" style={{ marginTop: 16 }}>
          Fund the escrow
        </Link>
      </div>
    );
  }

  return (
    <div className="card" style={{ marginTop: 20 }}>
      <p className="label" style={{ fontSize: 13, color: "var(--muted)" }}>
        Open the escrow
      </p>

      <div className="field" style={{ marginTop: 14 }}>
        <label>Type</label>
        <select value={mode} onChange={(e) => setMode(e.target.value as "bilateral" | "arbitrated")}>
          <option value="bilateral">2-party escrow</option>
          <option value="arbitrated">3-party escrow</option>
        </select>
      </div>

      <div className="field" style={{ marginTop: 14 }}>
        <label>Amount (BCH)</label>
        <input value={bch} onChange={(e) => setBch(e.target.value)} inputMode="decimal" />
        <p className="hint">The freelancer receives this minus the contract&apos;s fixed fee.</p>
      </div>

      {mode === "bilateral" ? (
        <div className="field" style={{ marginTop: 14 }}>
          <label>Reclaimable after</label>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
            <option value={60}>60 days</option>
          </select>
          <p className="hint">After this, the freelancer can take the funds back.</p>
        </div>
      ) : (
        <div className="field" style={{ marginTop: 14 }}>
          <label>Arbiter</label>
          <select value={arbiterId} onChange={(e) => setArbiterId(e.target.value)}>
            {(arbiters ?? []).map((a) => (
              <option key={a.userId} value={a.userId}>
                {a.displayName ?? a.userId.slice(0, 8)} — {(a.feeBps / 100).toFixed(2)}% fee
              </option>
            ))}
            {arbiters?.length === 0 && <option value="">No active arbiters</option>}
          </select>
        </div>
      )}

      {error && <p className="field-error" style={{ marginTop: 12 }}>{error}</p>}

      <button
        type="button"
        className="btn btn-primary btn-block"
        style={{ marginTop: 18 }}
        disabled={busy || !sats || (mode === "arbitrated" && !arbiterId)}
        onClick={() => void create()}
      >
        {busy ? <span className="spinner" /> : "Create escrow contract"}
      </button>
    </div>
  );
}
