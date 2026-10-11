"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  connectWallet,
  disconnectWallet,
  restoreSession,
  signMessage,
  signTransaction,
  startTwoPartySignature,
  completeTwoPartySignature,
  type WalletConnectConfig,
  type WalletSession
} from "@cash-freelancers/wallet-connect";
import { parseBchNetwork } from "@cash-freelancers/shared";
import { describeError, isUserRejection } from "@cash-freelancers/wallet-connect";

/**
 * The connected wallet (Cashonize / Paytaca / Zapit), lifted into React context.
 *
 * This owns the WalletConnect pairing only. It deliberately knows nothing about
 * jobs or escrows: those live in the server components, and a signed
 * transaction is requested explicitly by whichever screen needs it.
 */

const TOPIC_STORAGE_KEY = "cash-freelancers:wc-topic";

/**
 * next/font-style inlining rules apply to `process.env.NEXT_PUBLIC_*`: these
 * must be static property accesses, not a dynamic lookup, or the value is
 * inlined as undefined at build time.
 *
 * `network` falls back to Chipnet rather than Mainnet on purpose. A build with
 * a missing or misspelled variable must never be able to aim a real-money flow
 * at the main chain — the safe default for a payments app is the one where
 * losing money is impossible.
 *
 * `url` used to be a hardcoded `cashfreelancers.example` placeholder. The SDK
 * compares it against the real page origin, warns that they differ, and then
 * overrides it — so the placeholder bought nothing and made the warning
 * permanent. It is now configurable, with the dev origin as the default.
 */
const walletConnectConfig: WalletConnectConfig = {
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "",
  network: parseBchNetwork(process.env.NEXT_PUBLIC_BCH_NETWORK, "chipnet"),
  metadata: {
    name: "Cash Freelancers",
    description: "A freelance marketplace with payments on Bitcoin Cash",
    url: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
    icons: []
  }
};

export type WalletStatus = "idle" | "connecting" | "awaiting-approval" | "error";

interface WalletContextValue {
  session: WalletSession | null;
  status: WalletStatus;
  error: string | null;
  /** The wc: URI to render as a QR code, while waiting for wallet approval. */
  pairingUri: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  /** Close the QR modal and abandon the pairing request behind it. */
  dismissPairing: () => void;
  clearError: () => void;
  signMessage: (message: string) => Promise<string>;
  signTransaction: (
    wcTransactionObject: unknown
  ) => Promise<{ signedTransaction: string; signedTransactionHash: string }>;
  startTwoPartySignature: (
    wcTransactionObject: unknown
  ) => Promise<{ signedTransaction: string; signedTransactionHash: string }>;
  completeTwoPartySignature: (
    partiallySignedTransactionHex: string,
    sourceOutputs: unknown[]
  ) => Promise<{ signedTransaction: string; signedTransactionHash: string }>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<WalletSession | null>(null);
  const [pairingUri, setPairingUri] = useState<string | null>(null);
  const [status, setStatus] = useState<WalletStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  // Counts pairing attempts. A wallet's `approval()` promise stays pending
  // until the user acts, so dismissing the QR has to invalidate the attempt
  // it belongs to — otherwise a late approval would silently reconnect a modal
  // the user already closed, and a retry would fight it for the session.
  const attemptRef = useRef(0);

  // Restore a previous pairing on load. Only the topic is persisted, never
  // anything sensitive, and a topic the wallet no longer honours is discarded
  // rather than retried forever.
  useEffect(() => {
    const savedTopic = window.localStorage.getItem(TOPIC_STORAGE_KEY);
    if (!savedTopic) return;

    let cancelled = false;
    restoreSession(walletConnectConfig, savedTopic)
      .then((restored) => {
        if (cancelled) return;
        if (restored) setSession(restored);
        else window.localStorage.removeItem(TOPIC_STORAGE_KEY);
      })
      .catch(() => window.localStorage.removeItem(TOPIC_STORAGE_KEY));

    return () => {
      cancelled = true;
    };
  }, []);

  const connect = useCallback(async () => {
    const attempt = ++attemptRef.current;
    setStatus("connecting");
    setError(null);
    try {
      const { uri, approval } = await connectWallet(walletConnectConfig);
      if (attempt !== attemptRef.current) return;
      // The QR has to be on screen before approval resolves, otherwise a fast
      // wallet tap would leave the user staring at an empty modal.
      setPairingUri(uri);
      setStatus("awaiting-approval");
      const approved = await approval();
      if (attempt !== attemptRef.current) return;
      window.localStorage.setItem(TOPIC_STORAGE_KEY, approved.topic);
      setSession(approved);
      setPairingUri(null);
      setStatus("idle");
    } catch (err) {
      if (attempt !== attemptRef.current) return;
      if (isUserRejection(err)) {
        // Closing the wallet's sheet is a normal outcome of a handshake, not a
        // failure. Say nothing and leave the button ready to try again.
        setPairingUri(null);
        setStatus("idle");
        return;
      }
      setError(describeError(err));
      setPairingUri(null);
      setStatus("error");
    }
  }, []);

  const dismissPairing = useCallback(() => {
    attemptRef.current += 1;
    setPairingUri(null);
    setError(null);
    setStatus("idle");
  }, []);

  const disconnect = useCallback(async () => {
    if (!session) return;
    try {
      await disconnectWallet(walletConnectConfig, session.topic);
    } finally {
      window.localStorage.removeItem(TOPIC_STORAGE_KEY);
      setSession(null);
    }
  }, [session]);

  const requireSession = useCallback((): WalletSession => {
    if (!session) throw new Error("Connect a wallet first");
    return session;
  }, [session]);

  const value = useMemo<WalletContextValue>(
    () => ({
      session,
      status,
      error,
      pairingUri,
      connect,
      disconnect,
      dismissPairing,
      clearError: () => setError(null),
      signMessage: (message: string) => signMessage(walletConnectConfig, requireSession(), { message }),
      signTransaction: (wcTransactionObject: unknown) =>
        signTransaction(walletConnectConfig, requireSession(), wcTransactionObject as never),
      startTwoPartySignature: (wcTransactionObject: unknown) =>
        startTwoPartySignature(walletConnectConfig, requireSession(), wcTransactionObject as never),
      completeTwoPartySignature: (partiallySignedTransactionHex, sourceOutputs) =>
        completeTwoPartySignature(
          walletConnectConfig,
          requireSession(),
          partiallySignedTransactionHex,
          sourceOutputs
        )
    }),
    [session, status, error, pairingUri, connect, disconnect, dismissPairing, requireSession]
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const context = useContext(WalletContext);
  if (!context) throw new Error("useWallet must be used inside a WalletProvider");
  return context;
}
