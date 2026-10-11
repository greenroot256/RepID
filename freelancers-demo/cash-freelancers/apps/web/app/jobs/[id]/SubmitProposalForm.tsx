"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Job, Proposal } from "@cash-freelancers/shared";
import { api, ApiError } from "../../../lib/api";
import { bchToSats, formatBch } from "../../../lib/format";
import { useAuth } from "../../providers/AuthProvider";
import { Field } from "../../components/ui";

/**
 * Sending a proposal. Only rendered as a form for a signed-in non-client while
 * the job is still open; everyone else sees nothing, because there is nothing
 * they could do with it.
 */
export function SubmitProposalForm({ job }: { job: Job }) {
  const router = useRouter();
  const { user, loading } = useAuth();

  const [bch, setBch] = useState((job.budgetSats / 1e8).toFixed(4));
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading) return null;
  if (!user) return null;
  if (user.id === job.clientId) return null;
  if (job.status !== "open") return null;

  const sats = bchToSats(bch);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (sats === null || sats <= 0) {
      setError("Enter a BCH amount such as 0.05.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post<Proposal>(`/jobs/${job.id}/proposals`, {
        proposedAmountSats: sats,
        message: message.trim() || undefined
      });
      // Re-fetching the Server Component tree is what makes the new proposal
      // appear: the proposal list is read on the server.
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send the proposal");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ marginTop: 32 }}>
      <h3 style={{ fontSize: 18, marginBottom: 6 }}>Send a proposal</h3>
      <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 20 }}>
        The client pays into escrow only if they accept, so a proposal costs you nothing.
      </p>

      <form onSubmit={submit} noValidate>
        <Field label="Your price (BCH)" hint={`The client's budget is ${formatBch(job.budgetSats)}.`}>
          <input value={bch} onChange={(e) => setBch(e.target.value)} inputMode="decimal" />
        </Field>

        <div style={{ marginTop: 16 }}>
          <Field label="Message" hint="A short note on how you would do the work.">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              maxLength={1000}
            />
          </Field>
        </div>

        {error && <p className="field-error" style={{ marginTop: 12 }}>{error}</p>}

        <button
          type="submit"
          className="btn btn-primary"
          style={{ marginTop: 18 }}
          disabled={busy || sats === null}
        >
          {busy ? <span className="spinner" /> : "Send proposal"}
        </button>
      </form>
    </div>
  );
}
