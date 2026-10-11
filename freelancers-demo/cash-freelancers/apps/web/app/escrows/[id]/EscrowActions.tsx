"use client";

import { useState } from "react";
import type { Escrow } from "@cash-freelancers/shared";
import { api, ApiError } from "../../../lib/api";
import { formatBch } from "../../../lib/format";
import { useAuth } from "../../providers/AuthProvider";
import { useWallet } from "../../providers/WalletProvider";
import { Notice } from "../../components/ui";

export type ViewerRole = "client" | "freelancer" | "arbiter";

type WcResponse = {
  contractAddress: string;
  wcTransactionObject: unknown;
};

type FundingResponse = WcResponse & {
  amountSats: number;
  feeSats: number;
  fundingUtxos: { txid: string; vout: number; satoshis: number }[];
};

type Signer = (wc: unknown) => Promise<{ signedTransaction: string }>;

/**
 * The one action the current viewer may take on this escrow.
 *
 * The API decides what is legal (`requireEscrowClient`, `SETTLEMENT_RULES`, and
 * for arbitrated escrows a real 2-of-3). This component mirrors those rules so
 * the button set matches what the server would accept — and it still treats the
 * server as the authority: every branch re-reads the escrow after the wallet
 * round-trip rather than assuming success.
 *
 * Nothing here trusts the wallet's claim that a transaction was broadcast. The
 * signed hex is posted back to the API, which broadcasts it, verifies it
 * against the chain, and only then writes the new status.
 */
export function EscrowActions({
  escrow,
  viewerRole,
  onDone
}: {
  escrow: Escrow;
  viewerRole: ViewerRole;
  onDone: () => Promise<void>;
}) {
  const { session, signTransaction, startTwoPartySignature, completeTwoPartySignature } = useWallet();

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function run(key: string, action: () => Promise<string | null>) {
    setBusy(key);
    setError(null);
    setInfo(null);
    try {
      const message = await action();
      if (message) setInfo(message);
      await onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (!session) {
    return <Notice tone="warn">Connect the wallet that holds this escrow to act on it.</Notice>;
  }

  if (escrow.status === "pending_funding") {
    if (viewerRole !== "client") {
      return (
        <div className="card" style={{ marginTop: 22 }}>
          <h3 style={{ fontSize: 18, marginBottom: 8 }}>Waiting for funding</h3>
          <p style={{ color: "var(--muted)", fontSize: 14 }}>
            The client has to fund this contract before any work starts. You will be able to act once
            the BCH is in.
          </p>
        </div>
      );
    }

    return (
      <div className="card" style={{ marginTop: 22 }}>
        <h3 style={{ fontSize: 18, marginBottom: 8 }}>Fund this escrow</h3>
        <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 18 }}>
          {formatBch(escrow.amountSats)} moves from your wallet into the contract. Nobody can move it
          again until one of the settlement paths below is taken.
        </p>

        {error && <Notice tone="danger">{error}</Notice>}
        {info && <Notice>{info}</Notice>}

        <button
          type="button"
          className="btn btn-primary btn-block"
          disabled={busy !== null}
          onClick={() =>
            void run("fund", async () => {
              // Built server-side: the API reads the client's UTXOs from Electrum
              // and returns a WalletConnect object with placeholder unlocks. The
              // browser never holds a key, and the amount comes from the escrow
              // record rather than from anything sent up.
              const built = await api.get<FundingResponse>(`/escrows/${escrow.id}/funding-transaction`);
              const signed = await signTransaction(built.wcTransactionObject);
              const settled = await api.post<Escrow>(`/escrows/${escrow.id}/funding`, {
                signedTransactionHex: signed.signedTransaction
              });
              return `Funded. The contract now holds ${formatBch(settled.amountSats)}.`;
            })
          }
        >
          {busy === "fund" ? <span className="spinner" /> : `Fund ${formatBch(escrow.amountSats)}`}
        </button>
      </div>
    );
  }

  if (escrow.status === "disputed") {
    return (
      <div className="card" style={{ marginTop: 22 }}>
        <h3 style={{ fontSize: 18, marginBottom: 8 }}>Dispute open</h3>
        <Notice tone="warn">
          The money stays in the contract while this is resolved. On an arbitrated escrow an arbiter
          co-signs the outcome; on a bilateral one it is settled by the client releasing, or by the
          timeout being reached.
        </Notice>
      </div>
    );
  }

  if (escrow.status === "released" || escrow.status === "refunded") {
    return (
      <div className="card" style={{ marginTop: 22 }}>
        <h3 style={{ fontSize: 18 }}>Settled</h3>
        <p style={{ color: "var(--muted)", fontSize: 14, marginTop: 8 }}>
          {escrow.status === "released"
            ? "The payment went to the freelancer and the contract is empty."
            : "The money went back to the client and the contract is empty."}
        </p>
      </div>
    );
  }

  return (
    <FundedActions
      escrow={escrow}
      viewerRole={viewerRole}
      run={run}
      busy={busy}
      error={error}
      info={info}
      signTransaction={signTransaction}
      startTwoPartySignature={startTwoPartySignature}
      completeTwoPartySignature={completeTwoPartySignature}
    />
  );
}

interface FundedActionsProps {
  escrow: Escrow;
  viewerRole: ViewerRole;
  run: (key: string, action: () => Promise<string | null>) => Promise<void>;
  busy: string | null;
  error: string | null;
  info: string | null;
  signTransaction: Signer;
  startTwoPartySignature: Signer;
  completeTwoPartySignature: (hex: string, sourceOutputs: unknown[]) => Promise<{ signedTransaction: string }>;
}

function FundedActions({
  escrow,
  viewerRole,
  run,
  busy,
  error,
  info,
  signTransaction,
  startTwoPartySignature,
  completeTwoPartySignature
}: FundedActionsProps) {
  const [outcome, setOutcome] = useState<"release" | "refund">("release");

  async function bilateralRelease() {
    return run("release", async () => {
      const built = await api.get<WcResponse>(`/escrows/${escrow.id}/release-transaction`);
      const signed = await signTransaction(built.wcTransactionObject);
      await api.post(`/escrows/${escrow.id}/broadcast`, {
        signedTransactionHex: signed.signedTransaction,
        purpose: "release"
      });
      return "Released to the freelancer.";
    });
  }

  async function reclaim() {
    return run("reclaim", async () => {
      const built = await api.get<WcResponse>(`/escrows/${escrow.id}/reclaim-transaction`);
      const signed = await signTransaction(built.wcTransactionObject);
      await api.post(`/escrows/${escrow.id}/broadcast`, {
        signedTransactionHex: signed.signedTransaction,
        purpose: "reclaim"
      });
      return "Reclaimed after the timeout.";
    });
  }

  /**
   * Step 1: sign the placeholder and hand the half-signed hex to the API, which
   * stores it against the escrow tagged with this session as the signer.
   */
  async function firstSignature() {
    return run("first", async () => {
      const built = await api.get<WcResponse>(
        `/escrows/${escrow.id}/arbitrated-spend-transaction?outcome=${outcome}`
      );
      const signed = await startTwoPartySignature(built.wcTransactionObject);
      await api.post(`/escrows/${escrow.id}/arbitrated-spend/first-signature`, {
        signedTransactionHex: signed.signedTransaction,
        outcome
      });
      return "First signature recorded. Another party now co-signs.";
    });
  }

  /**
   * Step 2: a *different* party fetches the stored half, signs it, and posts it
   * back. The API refuses if this is the same session that made the first
   * signature — a 2-of-3 the first signer can finish alone is really a 1-of-3.
   */
  async function finalSignature() {
    return run("final", async () => {
      const pending = await api.get<{ transaction: string; sourceOutputs: unknown[] }>(
        `/escrows/${escrow.id}/arbitrated-spend/pending`
      );
      const signed = await completeTwoPartySignature(pending.transaction, pending.sourceOutputs);
      await api.post(`/escrows/${escrow.id}/arbitrated-spend/final-signature`, {
        signedTransactionHex: signed.signedTransaction
      });
      return "Settled on chain.";
    });
  }

  return (
    <div className="card" style={{ marginTop: 22 }}>
      <h3 style={{ fontSize: 18, marginBottom: 8 }}>
        {escrow.mode === "bilateral" ? "Settle this escrow" : "Co-sign the settlement"}
      </h3>

      {error && <Notice tone="danger">{error}</Notice>}
      {info && <Notice>{info}</Notice>}

      {escrow.mode === "bilateral" ? (
        viewerRole === "arbiter" ? (
          <Notice>
            You are not a party to this bilateral escrow, so you cannot move the money.
          </Notice>
        ) : (
          <div className="hero-actions" style={{ marginTop: 16 }}>
            {/* Only the client can release and only the freelancer can reclaim,
                because the covenant's two paths need exactly those signatures. */}
            {viewerRole === "client" ? (
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy !== null}
                onClick={() => void bilateralRelease()}
              >
                {busy === "release" ? <span className="spinner" /> : "Release to freelancer"}
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-line"
                disabled={busy !== null}
                onClick={() => void reclaim()}
              >
                {busy === "reclaim" ? <span className="spinner" /> : "Reclaim (after timeout)"}
              </button>
            )}
          </div>
        )
      ) : (
        <div style={{ marginTop: 16 }}>
          <div className="field">
            <label>Outcome</label>
            <select value={outcome} onChange={(e) => setOutcome(e.target.value as "release" | "refund")}>
              <option value="release">Release to the freelancer</option>
              <option value="refund">Refund to the client</option>
            </select>
            <p className="hint">
              Two of the three parties must sign the same transaction, and whichever two sign it
              decides the outcome.
            </p>
          </div>

          <div className="hero-actions" style={{ marginTop: 16 }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy !== null}
              onClick={() => void firstSignature()}
            >
              {busy === "first" ? <span className="spinner" /> : "Sign (first signature)"}
            </button>
            <button
              type="button"
              className="btn btn-line"
              disabled={busy !== null}
              onClick={() => void finalSignature()}
            >
              {busy === "final" ? <span className="spinner" /> : "Co-sign (second signature)"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
