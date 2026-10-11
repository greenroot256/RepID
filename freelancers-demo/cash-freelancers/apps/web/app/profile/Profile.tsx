"use client";

import { useState } from "react";
import type { ActiveRole, User } from "@cash-freelancers/shared";
import { api, ApiError } from "../../lib/api";
import { truncateAddress } from "../../lib/format";
import { useAuth } from "../providers/AuthProvider";
import { useWallet } from "../providers/WalletProvider";
import { Field, Notice, Pill, Spinner } from "../components/ui";
import { ReputationBadge } from "../components/ReputationBadge";

/**
 * Must match the API's minimum. The server enforces it regardless; this copy
 * only means the user finds out before submitting rather than after.
 */
const MIN_PASSWORD_LENGTH = 12;

export function Profile() {
  const { user, loading, refresh } = useAuth();
  const { session: walletSession, signMessage } = useWallet();
  const [displayName, setDisplayName] = useState("");
  const [repIdAddress, setRepIdAddress] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  if (loading) return <Spinner />;
  if (!user) return <Notice>Sign in to see your profile — with your email and password, or a wallet.</Notice>;

  async function saveName(event: React.FormEvent) {
    event.preventDefault();
    setBusy("name");
    setError(null);
    setInfo(null);
    try {
      await api.post<User>("/users", { displayName: displayName.trim() || user!.displayName });
      await refresh();
      setInfo("Display name updated.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update the profile");
    } finally {
      setBusy(null);
    }
  }

  /**
   * Attaching another wallet. The API requires a signature from the wallet being
   * attached, which this triggers through the connected WalletConnect session —
   * so the user is asked to approve in their wallet, not merely to type an
   * address. Without that proof, a hijacked session could bind somebody else's
   * wallet here and inherit it as a recovery path.
   */
  async function linkWallet() {
    setBusy("wallet");
    setError(null);
    setInfo(null);
    try {
      if (!walletSession) {
        setError("Connect the wallet you want to add, then try again.");
        return;
      }
      // Signed with the connected wallet, which must be the one being added:
      // that is the proof the API is checking for.
      const { address } = walletSession;
      const { challengeId, message } = await api.post<{ challengeId: string; message: string }>(
        "/auth/challenge",
        { walletAddress: address, purpose: "link-wallet" }
      );
      const signature = await signMessage(message);
      await api.post<User>("/users/me/wallets", { challengeId, signature });
      await refresh();
      setInfo("Wallet added to this account.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add the wallet");
    } finally {
      setBusy(null);
    }
  }

  /**
   * Points the account at one of its existing wallets. No signature is asked
   * for: the wallet is already linked, and this only decides what *new* escrows
   * use. Escrows already in flight keep the address they froze, so nothing that
   * has money in it moves.
   */
  async function activateWallet(address: string) {
    setBusy("wallet");
    setError(null);
    setInfo(null);
    try {
      await api.post<User>("/users/me/active-wallet", { address });
      await refresh();
      setInfo("Active wallet switched.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not switch the active wallet");
    } finally {
      setBusy(null);
    }
  }

  /**
   * Sets or changes the password.
   *
   * An account that has no password yet is setting one for the first time and is
   * already authenticated by wallet, so there is no current password to ask
   * for. One that has a password must present it — that is what stops a stolen
   * session from locking the real owner out permanently.
   */
  async function savePassword(event: React.FormEvent) {
    event.preventDefault();
    setBusy("password");
    setError(null);
    setInfo(null);
    try {
      await api.post<User>("/auth/password", {
        ...(user!.hasPassword ? { currentPassword } : {}),
        newPassword
      });
      setCurrentPassword("");
      setNewPassword("");
      await refresh();
      setInfo("Password updated.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update the password");
    } finally {
      setBusy(null);
    }
  }

  /**
   * Switching the working mode.
   *
   * Purely a display preference — every route that depends on being a client or
   * a freelancer checks the role the user holds in the resource in question, so
   * this cannot unlock anything. The UI says as much, because a switch that
   * looks like a permission change would be very misleading.
   */
  async function switchRole(activeRole: ActiveRole) {
    if (activeRole === user!.activeRole) return;
    setBusy("role");
    setError(null);
    try {
      await api.post<User>("/users/me/active-role", { activeRole });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not switch mode");
    } finally {
      setBusy(null);
    }
  }

  /**
   * Linking a RepID is just recording the address against the account. It proves
   * nothing by itself, so the API only allows it for the caller's own id — and
   * the escrow covenants never require one.
   */
  async function linkRepId(event: React.FormEvent) {
    event.preventDefault();
    setBusy("repid");
    setError(null);
    setInfo(null);
    try {
      await api.post<void>(`/users/${user!.id}/repid`, { repIdAddress: repIdAddress.trim() });
      await refresh();
      setRepIdAddress("");
      setInfo("RepID linked to this account.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not link the RepID");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="detail-grid">
      <div className="card">
        <div className="card-head">
          <div>
            <p className="label">Display name</p>
            <p className="job">{user.displayName}</p>
          </div>
        </div>

        <form onSubmit={saveName}>
          <Field label="What other people see" hint="Not your wallet address. Changeable at any time.">
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={user.displayName}
              maxLength={60}
            />
          </Field>
          <button type="submit" className="btn btn-primary" style={{ marginTop: 16 }} disabled={busy !== null}>
            {busy === "name" ? <span className="spinner" /> : "Save"}
          </button>
        </form>

        <hr className="divider" />

        <h3 style={{ fontSize: 17, marginBottom: 8 }}>Wallets</h3>
        <p style={{ fontSize: 14, color: "var(--muted)", marginBottom: 14 }}>
          More than one wallet, one active. Switching changes what new escrows use — anything already
          in flight keeps the address it was created with, so funds in an escrow are never stranded
          on an address you stopped using.
        </p>

        {user.wallets.map((wallet) => (
          <div key={wallet.address} className="id-chip" style={{ padding: 14, marginBottom: 10 }}>
            <div className="id-row">
              <span className="mono">{truncateAddress(wallet.address, 12, 8)}</span>
              {wallet.active ? <Pill>active</Pill> : null}
            </div>
            {wallet.lastUsedAt && (
              <div className="id-row">
                <span>Last used</span>
                <b>{new Date(wallet.lastUsedAt).toLocaleDateString("en-US")}</b>
              </div>
            )}
            {!wallet.active && (
              <button
                type="button"
                className="btn btn-line btn-sm"
                style={{ marginTop: 10 }}
                disabled={busy !== null}
                onClick={() => void activateWallet(wallet.address)}
              >
                Make active
              </button>
            )}
          </div>
        ))}

        <button
          type="button"
          className="btn btn-line"
          style={{ marginTop: 8 }}
          disabled={busy !== null}
          onClick={() => void linkWallet()}
        >
          {busy === "wallet" ? <span className="spinner" /> : "Add a wallet"}
        </button>
        <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 10 }}>
          {walletSession
            ? "Your wallet will ask you to approve the request."
            : "Connect the wallet you want to add first — you will be asked to approve it there."}
        </p>

        <hr className="divider" />

        <h3 style={{ fontSize: 17, marginBottom: 8 }}>Password</h3>
        {user.hasPassword ? (
          <form onSubmit={savePassword}>
            <Field label="Current password" hint="Required to change it, so a stolen session cannot lock you out.">
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
              />
            </Field>
            <div style={{ marginTop: 12 }}>
              <Field
                label="New password"
                hint={`At least ${MIN_PASSWORD_LENGTH} characters. A short passphrase beats a short word with a digit on the end.`}
              >
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </Field>
            </div>
            <button
              type="submit"
              className="btn btn-primary"
              style={{ marginTop: 16 }}
              disabled={busy !== null || newPassword.length < MIN_PASSWORD_LENGTH}
            >
              {busy === "password" ? <span className="spinner" /> : "Change password"}
            </button>
          </form>
        ) : (
          <form onSubmit={savePassword}>
            <Notice>
              This account has no password yet, so it can only be recovered through a linked wallet.
              Setting one is the thing that makes it recoverable.
            </Notice>
            <div style={{ marginTop: 12 }}>
              <Field label="New password" hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </Field>
            </div>
            <button
              type="submit"
              className="btn btn-primary"
              style={{ marginTop: 16 }}
              disabled={busy !== null || newPassword.length < MIN_PASSWORD_LENGTH}
            >
              {busy === "password" ? <span className="spinner" /> : "Set password"}
            </button>
          </form>
        )}

        <hr className="divider" />

        <h3 style={{ fontSize: 17, marginBottom: 8 }}>Working mode</h3>
        <p style={{ fontSize: 14, color: "var(--muted)", marginBottom: 12 }}>
          Changes which dashboard you see. It is a preference, not a permission: you can hire and be
          hired in either mode, and nothing is locked or unlocked by this.
        </p>
        <div className="escrow-modes" style={{ gridTemplateColumns: "1fr 1fr" }}>
          {(["client", "freelancer"] as const).map((role) => (
            <button
              key={role}
              type="button"
              className={user.activeRole === role ? "mode active" : "mode"}
              disabled={busy !== null}
              onClick={() => void switchRole(role)}
            >
              <span className="mode-tag">{role === "client" ? "hiring" : "working"}</span>
              <h3>{role === "client" ? "Client" : "Freelancer"}</h3>
            </button>
          ))}
        </div>

        <hr className="divider" />

        <h3 style={{ fontSize: 17, marginBottom: 8 }}>RepID</h3>
        {user.repId ? (
          <div className="id-chip" style={{ padding: 16 }}>
            <div className="id-row">
              <span>Linked</span>
              <b className="mono">{truncateAddress(user.repId.repIdAddress, 12, 8)}</b>
            </div>
            <div className="id-row">
              <span>Since</span>
              <b>{new Date(user.repId.linkedAt).toLocaleDateString("en-US")}</b>
            </div>
            <ReputationBadge address={user.repId.repIdAddress} />
          </div>
        ) : (
          <form onSubmit={linkRepId}>
            <Field
              label="RepID address"
              hint="Optional. Reputation is a signal, never a requirement: no escrow path needs one."
            >
              <input
                value={repIdAddress}
                onChange={(e) => setRepIdAddress(e.target.value)}
                placeholder="bchtest:q…"
              />
            </Field>
            <button
              type="submit"
              className="btn btn-line"
              style={{ marginTop: 16 }}
              disabled={busy !== null || repIdAddress.trim().length < 10}
            >
              {busy === "repid" ? <span className="spinner" /> : "Link RepID"}
            </button>
          </form>
        )}
      </div>

      <aside className="sticky-side">
        <div className="card">
          <p className="label" style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>
            Account
          </p>
          <div className="row">
            <span>Active wallet</span>
            <b className="mono">{truncateAddress(user.walletAddress)}</b>
          </div>
          <div className="row">
            <span>Sign-in email</span>
            <b>{user.email ?? <span style={{ color: "var(--muted)" }}>none set</span>}</b>
          </div>
          <div className="row">
            <span>Username</span>
            <b>{user.username ?? <span style={{ color: "var(--muted)" }}>none set</span>}</b>
          </div>
          <div className="row">
            <span>Mode</span>
            <b style={{ textTransform: "capitalize" }}>{user.activeRole}</b>
          </div>
          <div className="row">
            <span>Roles</span>
            <b style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
              {user.roles.length === 0 ? (
                <span style={{ color: "var(--muted)" }}>client / freelancer</span>
              ) : (
                user.roles.map((role) => <Pill key={role}>{role}</Pill>)
              )}
            </b>
          </div>
          <div className="row">
            <span>Member since</span>
            <b>{new Date(user.createdAt).toLocaleDateString("en-US")}</b>
          </div>
        </div>

        {error && <Notice tone="danger">{error}</Notice>}
        {info && <Notice>{info}</Notice>}

        <div className="card" style={{ marginTop: 20 }}>
          <p style={{ fontSize: 14, color: "var(--muted)" }}>
            Anyone can hire and be hired as a client or freelancer — those are capabilities, not
            permissions. The <b>arbiter</b> role is the only one you can add yourself, and it is what
            lets you co-sign an arbitrated settlement.
          </p>
        </div>
      </aside>
    </div>
  );
}
