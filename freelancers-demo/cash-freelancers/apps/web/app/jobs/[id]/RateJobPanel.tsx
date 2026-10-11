"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Job, Rating } from "@cash-freelancers/shared";
import { api, ApiError } from "../../../lib/api";
import { useAuth } from "../../providers/AuthProvider";
import { Field } from "../../components/ui";

/**
 * Leaves a rating for the freelancer once the job is done.
 *
 * Only the client is offered this form, because that is the only direction the
 * API accepts: `POST /jobs/:jobId/ratings` resolves the ratee as "the other
 * party" from a client session. Offering the freelancer a form that always 403s
 * would be worse than not offering it.
 */
export function RateJobPanel({ job }: { job: Job }) {
  const router = useRouter();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [score, setScore] = useState(5);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const visible = user?.id === job.clientId && job.freelancerId && job.status === "completed";

  if (!visible) return null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post<Rating>(`/jobs/${job.id}/ratings`, {
        rateeId: job.freelancerId,
        score,
        comment: comment.trim() || undefined
      });
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the rating");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="card" style={{ marginTop: 20 }}>
        <p style={{ fontSize: 14, color: "var(--muted)", marginBottom: 16 }}>
          This job is complete. Ratings become part of the freelancer&apos;s RepID trust score.
        </p>
        <button type="button" className="btn btn-primary btn-block" onClick={() => setOpen(true)}>
          Rate the freelancer
        </button>
      </div>
    );
  }

  return (
    <form className="card" style={{ marginTop: 20 }} onSubmit={submit}>
      <h3 style={{ fontSize: 17, marginBottom: 14 }}>Rate the freelancer</h3>

      <Field label={`Score: ${score} / 5`}>
        <input
          type="range"
          min={1}
          max={5}
          step={1}
          value={score}
          onChange={(e) => setScore(Number(e.target.value))}
        />
      </Field>

      <div style={{ marginTop: 14 }}>
        <Field label="Comment" hint="Optional. Other clients see this on the freelancer's profile.">
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} maxLength={500} />
        </Field>
      </div>

      {error && <p className="field-error" style={{ marginTop: 12 }}>{error}</p>}

      <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? <span className="spinner" /> : "Save rating"}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
