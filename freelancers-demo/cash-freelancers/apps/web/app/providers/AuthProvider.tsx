"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { User } from "@cash-freelancers/shared";
import { api, ApiError, getToken, setToken } from "../../lib/api";
import { useWallet } from "./WalletProvider";

/**
 * The platform session: which user is signed in.
 *
 * There are two ways in, and they are not equivalent:
 *
 *   - With a password, over email. This is the normal way to use the site, and
 *     it needs no wallet at all.
 *   - With a wallet, by signing a server-issued challenge. This both signs in and
 *     is the only way to create an account or attach a new wallet.
 *
 * The distinction is kept in the type rather than collapsed into one `signIn`
 * because the UI has to say something different in each case. A wallet holding a
 * key that no account uses is not a failed sign-in, it is an account waiting to
 * be created; the API says so with `registerable`, and the caller decides
 * whether to offer registration.
 */

export interface RegisterInput {
  username: string;
  email: string;
  password: string;
}

interface AuthContextValue {
  user: User | null;
  /** True until the stored token has been checked against the API. */
  loading: boolean;
  /** Set when a sign-in attempt failed; cleared on the next attempt. */
  error: string | null;
  /**
   * True when the last wallet sign-in found no account for the connected
   * wallet. The UI should offer registration rather than an error, and this is
   * how it knows to.
   */
  needsRegistration: boolean;
  /** Signs in with the connected wallet. */
  signIn: () => Promise<void>;
  /** Creates an account for the connected wallet. */
  register: (input: RegisterInput) => Promise<void>;
  /** Signs in with an email and password, no wallet needed. */
  signInWithPassword: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Re-reads the signed-in user, e.g. after updating the profile. */
  refresh: () => Promise<void>;
  /**
   * Clears `needsRegistration`, so a cancelled registration form does not leave
   * a banner behind.
   */
  dismissRegistrationPrompt: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { session, signMessage } = useWallet();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsRegistration, setNeedsRegistration] = useState(false);

  // Re-check a stored token on mount. `GET /auth/me` is the authority on
  // whether it is still good; the client cannot tell from the token itself.
  useEffect(() => {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    api
      .get<User>("/auth/me")
      .then((me) => {
        // The route replies 200 with an empty body if the user row disappeared,
        // so a response without an id means "not signed in" rather than a
        // usable session.
        if (me && me.id) setUser(me);
        else setToken(null);
      })
      .catch((err) => {
        // apiFetch already clears the token on 401.
        if (!(err instanceof ApiError && err.isUnauthorized)) {
          setError((err as Error).message);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  // Reaching this provider with a wallet connected and no session almost always
  // means the user connected one to try the site and there is no account for it
  // yet. Offering registration there, rather than making them find the sign-in
  // button first, is the difference between a first-run dead end and an obvious
  // next step. Sign-in is attempted automatically; if the wallet has no account
  // the API answers 409 and `signIn` sets the flag.
  useEffect(() => {
    if (session && !user && !loading && !error) {
      void signIn();
    }
    // Intentionally keyed on the session address only: `signIn` closes over
    // `loading`/`error`/`user`, and including them here would re-trigger the
    // attempt after it finishes and set `needsRegistration`, which would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.address]);

  /**
   * Requests a challenge for the connected wallet and returns it unsigned.
   *
   * Shared by sign-in and registration because both need the same proof, and
   * because the challenge is single-use: whoever signs it first consumes it. So
   * this is called once per attempt, immediately before the signature is
   * collected, never speculatively.
   */
  const requestChallenge = useCallback(
    async (purpose: "sign-in" | "link-wallet" = "sign-in") => {
      if (!session) throw new Error("Connect a wallet first");
      const { challengeId, message } = await api.post<{ challengeId: string; message: string }>(
        "/auth/challenge",
        { walletAddress: session.address, purpose },
        { anonymous: true }
      );
      return { challengeId, message, signature: await signMessage(message) };
    },
    [session, signMessage]
  );

  const signIn = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNeedsRegistration(false);
    try {
      const { challengeId, signature } = await requestChallenge();
      const result = await api.post<{ token: string; user: User } & { registerable?: boolean }>(
        "/auth/verify",
        { challengeId, signature },
        { anonymous: true }
      );
      if (result.registerable) {
        // Not an error: the wallet proved itself, there is simply no account for
        // it yet. The flag is what turns "sign-in failed" into "create an
        // account", which is the difference between a dead end and a prompt.
        setNeedsRegistration(true);
        return;
      }
      setToken(result.token);
      setUser(result.user);
    } catch (err) {
      setError((err as Error).message);
      setToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, [requestChallenge]);

  const register = useCallback(
    async (input: RegisterInput) => {
      setLoading(true);
      setError(null);
      try {
        const { challengeId, signature } = await requestChallenge();
        const { token, user: created } = await api.post<{ token: string; user: User }>(
          "/auth/register",
          { challengeId, signature, ...input },
          { anonymous: true }
        );
        setToken(token);
        setUser(created);
        setNeedsRegistration(false);
      } catch (err) {
        setError((err as Error).message);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [requestChallenge]
  );

  const signInWithPassword = useCallback(async (email: string, password: string) => {
    setLoading(true);
    setError(null);
    setNeedsRegistration(false);
    try {
      const { token, user: signedIn } = await api.post<{ token: string; user: User }>(
        "/auth/login",
        { email, password },
        { anonymous: true }
      );
      setToken(token);
      setUser(signedIn);
    } catch (err) {
      setError((err as Error).message);
      setToken(null);
      setUser(null);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const dismissRegistrationPrompt = useCallback(() => setNeedsRegistration(false), []);

  const signOut = useCallback(async () => {
    try {
      // Best-effort: the server should drop the session, but a local sign-out
      // must succeed even if it cannot be reached.
      await api.post<void>("/auth/logout");
    } catch {
      /* ignored on purpose */
    } finally {
      setToken(null);
      setUser(null);
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const me = await api.get<User>("/auth/me");
      if (me && me.id) setUser(me);
    } catch {
      /* keep the previous user rather than blanking the UI */
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      error,
      needsRegistration,
      signIn,
      register,
      signInWithPassword,
      signOut,
      refresh,
      dismissRegistrationPrompt
    }),
    [
      user,
      loading,
      error,
      needsRegistration,
      signIn,
      register,
      signInWithPassword,
      signOut,
      refresh,
      dismissRegistrationPrompt
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside an AuthProvider");
  return context;
}
