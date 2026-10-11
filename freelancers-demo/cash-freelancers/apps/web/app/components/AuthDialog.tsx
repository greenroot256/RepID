"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "../providers/AuthProvider";
import { useWallet } from "../providers/WalletProvider";

export type AuthMode = "signin" | "register";

/**
 * Sign in, or create an account.
 *
 * Registration is only reachable with a connected wallet, because it has to
 * prove control of the wallet that will be linked to the account. Password
 * sign-in needs no wallet, which is the point: an account survives losing its
 * wallet precisely because the wallet is not the only way in.
 *
 * The password policy is the API's, not this form's. The minimum is duplicated
 * here only so the user finds out before submitting rather than after; the
 * server enforces it either way, and a client-side rule that disagreed with it
 * would be a rule that lies.
 */
const MIN_PASSWORD_LENGTH = 12;

export default function AuthDialog({ mode, onClose }: { mode: AuthMode; onClose: () => void }) {
  const { register, signInWithPassword, signIn, loading, error, user } = useAuth();
  const { session } = useWallet();
  const [mounted, setMounted] = useState(false);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // If signing in with a wallet succeeds while the dialog is open, there is
  // nothing left to ask for. Without this the user sits in front of a form for
  // an account they are already signed into.
  useEffect(() => {
    if (user) onClose();
  }, [user, onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);

    if (mode === "register") {
      if (!session) {
        setLocalError("Connect your wallet first — creating an account proves you control it.");
        return;
      }
      if (password.length < MIN_PASSWORD_LENGTH) {
        setLocalError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
        return;
      }
      try {
        await register({ username, email, password });
      } catch {
        // The provider holds the message; re-thrown so the form stays open.
      }
      return;
    }

    try {
      await signInWithPassword(email, password);
    } catch {
      // As above.
    }
  }

  if (!mounted) return null;

  return createPortal(
    <div className="wallet-qr" role="dialog" aria-modal="true" aria-label={title(mode)} onClick={onClose}>
      <div className="wallet-qr-panel" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ fontSize: 20 }}>{title(mode)}</h3>

        {mode === "register" && !session && (
          <p className="field-error" role="alert">
            Connect your wallet first. Creating an account proves you control the wallet it will be
            linked to.
          </p>
        )}

        <form onSubmit={handleSubmit} style={{ display: "grid", gap: 12, marginTop: 16 }}>
          {mode === "register" && (
            <label>
              <span className="field-label">Username</span>
              <input
                className="field-input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required
                maxLength={24}
              />
              <span className="field-hint">Letters, numbers, underscores and hyphens. Shown publicly.</span>
            </label>
          )}

          <label>
            <span className="field-label">Email</span>
            <input
              className="field-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
            {mode === "register" && (
              <span className="field-hint">Your sign-in name. Not verified yet.</span>
            )}
          </label>

          <label>
            <span className="field-label">Password</span>
            <input
              className="field-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "register" ? "new-password" : "current-password"}
              required
            />
            {mode === "register" && (
              <span className="field-hint">
                At least {MIN_PASSWORD_LENGTH} characters. This is how you get back in if you lose
                your wallet.
              </span>
            )}
          </label>

          {(localError || error) && (
            <p className="field-error" role="alert">
              {localError ?? error}
            </p>
          )}

          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading || (mode === "register" && !session)}
          >
            {loading ? <span className="spinner" /> : mode === "register" ? "Create account" : "Sign in"}
          </button>
        </form>

        {mode === "signin" && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ marginTop: 14 }}
            disabled={!session}
            onClick={() => void signIn()}
          >
            {session ? "Use your wallet instead" : "Connect a wallet to sign in with it"}
          </button>
        )}

        <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} onClick={onClose}>
          Close
        </button>
      </div>
    </div>,
    document.body
  );
}

function title(mode: AuthMode) {
  return mode === "register" ? "Create your account" : "Sign in";
}
