"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { JOB_CATEGORIES, type EscrowMode, type Job } from "@cash-freelancers/shared";
import { api, ApiError } from "../../../lib/api";
import { bchToSats } from "../../../lib/format";
import { useAuth } from "../../providers/AuthProvider";
import { Field, Notice } from "../../components/ui";

/**
 * Posting a job requires a platform session, so the form checks for one up
 * front and links to sign-in rather than failing on submit with a 401.
 */
export function NewJobForm() {
  const router = useRouter();
  const { user, loading } = useAuth();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [bch, setBch] = useState("0.05");
  const [category, setCategory] = useState<string>(JOB_CATEGORIES[0]);
  const [mode, setMode] = useState<EscrowMode>("bilateral");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Parse in BCH because that is how the reference (and the user) thinks about
  // the number, then convert to the integer satoshis the API stores.
  const sats = bchToSats(bch);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    setErrors({});

    // Non-empty, and nothing more. This used to demand 8 characters of title
    // and 30 of description, which is a rule about how people write rather than
    // a rule about the data: "fix" or "same as last time" are legitimate, and a
    // title pad the user typed to satisfy a counter is a worse title than a
    // short honest one. The API enforces exactly this, so the two cannot drift.
    const nextErrors: Record<string, string> = {};
    if (title.trim().length === 0) nextErrors.title = "Give the job a title.";
    if (description.trim().length === 0) nextErrors.description = "Describe what needs doing.";
    if (sats === null) nextErrors.bch = "Enter a BCH amount such as 0.05.";
    else if (sats < 10_000) nextErrors.bch = "The minimum budget is 0.0001 BCH.";
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      setSubmitting(false);
      return;
    }

    try {
      const job = await api.post<Job>("/jobs", {
        title: title.trim(),
        description: description.trim(),
        budgetSats: sats,
        category,
        preferredMode: mode
      });
      router.push(`/jobs/${job.id}`);
    } catch (err) {
      setSubmitError(
        err instanceof ApiError ? err.message : "Could not post the job. Is the API running?"
      );
      setSubmitting(false);
    }
  }

  if (loading) return null;

  if (!user) {
    return (
      <div className="form">
        <Notice>Sign in to post a job — with your email and password, or by connecting a wallet.</Notice>
      </div>
    );
  }

  // The API refuses a job from an account with no wallet, because the client's
  // wallet is frozen into the escrow they will have to sign. Saying so here
  // beats letting the submit fail with a message about escrow signing.
  if (!user.wallets.some((w) => w.active)) {
    return (
      <div className="form">
        <Notice>
          Link a wallet from your profile before posting a job. Escrows are signed by your wallet, so
          a job posted without one could not be funded.
        </Notice>
      </div>
    );
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      {submitError && <div className="form-error">{submitError}</div>}

      <Field label="Title" error={errors.title}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Landing page redesign for a coffee brand"
          maxLength={120}
        />
      </Field>

      <Field
        label="Category"
        hint="Used for the board filters only."
      >
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          {JOB_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="What needs doing?"
        hint="Freelancers quote from this. Be specific about deliverables and deadline."
        error={errors.description}
      >
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={7}
          maxLength={4000}
        />
      </Field>

      <Field
        label="Budget (BCH)"
        hint={sats !== null ? `≈ ${sats.toLocaleString("en-US")} satoshis` : "Whole BCH amounts, up to 8 decimals."}
        error={errors.bch}
      >
        <input value={bch} onChange={(e) => setBch(e.target.value)} inputMode="decimal" />
      </Field>

      <Field
        label="Escrow type"
        hint="The freelancer sees this before they apply. You can still fund either type later, but this is what they expect."
      >
        <div className="escrow-modes">
          <button
            type="button"
            className={mode === "bilateral" ? "mode active" : "mode"}
            onClick={() => setMode("bilateral")}
          >
            <span className="mode-tag">2-party</span>
            <h3>You release, or they reclaim</h3>
            <p>No third party. After the timeout passes the freelancer can take the funds back.</p>
          </button>
          <button
            type="button"
            className={mode === "arbitrated" ? "mode active" : "mode"}
            onClick={() => setMode("arbitrated")}
          >
            <span className="mode-tag">3-party</span>
            <h3>An arbiter decides disputes</h3>
            <p>A neutral third party co-signs, so neither side can be pressured into a bad outcome.</p>
          </button>
        </div>
      </Field>

      <div>
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? <span className="spinner" /> : "Post job"}
        </button>
      </div>
    </form>
  );
}
