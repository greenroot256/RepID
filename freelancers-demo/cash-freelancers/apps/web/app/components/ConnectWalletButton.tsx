"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";
import { useWallet } from "../providers/WalletProvider";
import { useAuth } from "../providers/AuthProvider";
import { truncateAddress } from "../../lib/format";
import AuthDialog, { type AuthMode } from "./AuthDialog";

/**
 * The wallet and identity controls in the header.
 *
 * Three states, and they are genuinely different actions rather than one button
 * with a swapped label:
 *
 *   no wallet        -> connect
 *   wallet, no user  -> create an account, because a wallet pairing proves a key
 *                       and nothing about identity
 *   wallet + user    -> the account, plus a way to sign out
 *
 * Note that signing in is no longer tied to a wallet. `AuthDialog` handles
 * password sign-in too, so a user who signed in with their email and never
 * connected anything still has a working session, and the header has to be able
 * to show that state. The wallet box therefore only appears when there is a
 * wallet to show.
 */
export function ConnectWalletButton() {
  const { session, status, error, pairingUri, connect, disconnect, dismissPairing, clearError } = useWallet();
  const { user, signOut, needsRegistration, dismissRegistrationPrompt } = useAuth();
  const [dialogMode, setDialogMode] = useState<AuthMode | null>(null);

  if (pairingUri) return <PairingModal uri={pairingUri} onDismiss={dismissPairing} />;

  // A wallet is connected but no account exists for it. Rather than showing a
  // sign-in button that is guaranteed to end in "no account found", open
  // registration straight away.
  if (session && needsRegistration && !user) {
    return (
      <>
        <RegisterPrompt
          address={session.address}
          onDismiss={dismissRegistrationPrompt}
          onRegister={() => setDialogMode("register")}
        />
        {dialogMode && <AuthDialog mode={dialogMode} onClose={() => setDialogMode(null)} />}
      </>
    );
  }

  if (user) {
    return (
      <div className="wallet-box">
        <span className="wallet-address" title={user.email ?? user.displayName}>
          <span className="rep-dot" aria-hidden="true" />
          {user.username ?? user.displayName}
          {session && (
            <span className="mono">{truncateAddress(session.address)}</span>
          )}
        </span>
        {session && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              clearError();
              void disconnect();
            }}
          >
            Disconnect
          </button>
        )}
        <button type="button" className="btn btn-line btn-sm" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    );
  }

  if (session) {
    return (
      <div className="wallet-box">
        <span className="wallet-address" title={session.address}>
          <span className="rep-dot" aria-hidden="true" />
          <span className="mono">{truncateAddress(session.address)}</span>
        </span>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setDialogMode("signin")}>
          Sign in
        </button>
        {dialogMode && <AuthDialog mode={dialogMode} onClose={() => setDialogMode(null)} />}
      </div>
    );
  }

  return (
    <div className="wallet-box">
      <button
        type="button"
        className="btn btn-ghost"
        onClick={() => setDialogMode("signin")}
      >
        Sign in
      </button>
      <button
        type="button"
        className="btn btn-primary"
        disabled={status === "connecting"}
        onClick={() => void connect()}
      >
        {status === "connecting" ? <span className="spinner" /> : "Connect wallet"}
      </button>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {dialogMode && <AuthDialog mode={dialogMode} onClose={() => setDialogMode(null)} />}
    </div>
  );
}

/**
 * Shown when a wallet is connected with no account behind it. Registration needs
 * a signature from that wallet, so the prompt is about what happens next rather
 * than a form — the dialog collects the details once the user commits.
 */
function RegisterPrompt({
  address,
  onRegister,
  onDismiss
}: {
  address: string;
  onRegister: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="wallet-box">
      <span className="wallet-address" title={address}>
        <span className="rep-dot" aria-hidden="true" />
        <span className="mono">{truncateAddress(address)}</span>
      </span>
      <button type="button" className="btn btn-primary btn-sm" onClick={onRegister}>
        Create account
      </button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onDismiss}>
        Not now
      </button>
    </div>
  );
}

/**
 * The pairing QR. Encoded client-side from the wc: URI the wallet-connect
 * package returns, so no URI is ever sent anywhere.
 *
 * Rendered through a portal to <body> on purpose. This component lives inside
 * the site header, and the header sets `backdrop-filter: blur(6px)` for its
 * frosted-glass effect. A `backdrop-filter` (like `filter` or `transform`)
 * makes that element the containing block for any `position: fixed` descendant,
 * so the overlay's `inset: 0` would size itself to the ~70px-tall header
 * instead of the viewport: the panel would centre inside that box and spill off
 * the top of the screen, and the backdrop would only dim the header rather than
 * the page. Portalling to <body> puts the overlay back in the viewport's
 * coordinate space without changing the header's design.
 */
function PairingModal({ uri, onDismiss }: { uri: string; onDismiss: () => void }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  // document.body does not exist while this renders on the server, and the
  // mounted flag also keeps the portal from being a hydration mismatch.
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(uri)
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [uri]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  if (!mounted) return null;

  return createPortal(
    <div
      className="wallet-qr"
      role="dialog"
      aria-modal="true"
      aria-label="Scan to connect your wallet"
      onClick={onDismiss}
    >
      <div className="wallet-qr-panel" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ fontSize: 20 }}>Scan with your wallet</h3>
        {dataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={dataUrl} alt="WalletConnect pairing QR code" width={220} height={220} />
        ) : (
          <div className="spinner" style={{ margin: "26px auto" }} />
        )}
        <p>Cashonize, Paytaca and Zapit all support this pairing.</p>
        <details>
          <summary style={{ fontSize: 13, color: "var(--muted)", marginTop: 12, cursor: "pointer" }}>
            Show the pairing link instead
          </summary>
          <p className="mono" style={{ wordBreak: "break-all", fontSize: 11, marginTop: 10 }}>
            {uri}
          </p>
        </details>
        <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 16 }} onClick={onDismiss}>
          Cancel
        </button>
      </div>
    </div>,
    document.body
  );
}
