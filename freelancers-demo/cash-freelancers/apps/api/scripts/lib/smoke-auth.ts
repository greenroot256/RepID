import { hexToBin } from "@bitauth/libauth";
import { signMessageForTesting } from "../../src/utils/bch-message.js";

/**
 * Shared sign-in helper for the smoke tests.
 *
 * Since /auth/verify stopped creating accounts, a test that signs in with a
 * wallet needs somewhere for that wallet to be an account already. Against a
 * warm database that is simply true — the test wallets were registered by an
 * earlier run. Against a fresh one it is not, so `signIn` registers on demand
 * rather than assuming either state. That keeps the tests runnable against a
 * clean database, which is the only way a test like this is worth trusting: a
 * suite that only passes because of leftover rows proves nothing about a new
 * deployment.
 */

export interface Wallet {
  role: string;
  address: string;
  privateKeyHex: string;
}

export interface Session {
  token: string;
  id: string;
  address: string;
}

export interface ApiClient {
  api(
    path: string,
    options?: { method?: string; body?: unknown; token?: string }
  ): Promise<{ status: number; body: any }>;
}

/** Long enough to clear MIN_PASSWORD_LENGTH, and constant so tests are stable. */
export const TEST_PASSWORD = "smoke-test-password-1";

/**
 * A username/email unique to this wallet.
 *
 * Derived from the address rather than from a run id, so the same wallet
 * resolves to the same identity on every run. That matters because uniqueness
 * is enforced by the database: a per-run id would work once and then fail to
 * register on the second run against the same database, turning a stale-fixture
 * problem into a confusing "username already taken" on an account that was
 * never created.
 */
function identityFor(address: string) {
  const slug = `w${address.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(-14)}`;
  return { username: slug.slice(0, 24), email: `${slug}@example.test` };
}

export function makeIdentity(address: string) {
  return identityFor(address);
}

/**
 * Signs a `purpose` challenge with a wallet and returns the challenge id and
 * signature without submitting them, so a test can submit them to whichever
 * endpoint it is exercising.
 */
export async function signChallenge(
  client: ApiClient,
  address: string,
  privateKeyHex: string,
  purpose: "sign-in" | "link-wallet" | "activate-wallet" = "sign-in"
): Promise<{ challengeId: string; message: string; signature: string }> {
  const c = await client.api("/auth/challenge", {
    method: "POST",
    body: { walletAddress: address, purpose }
  });
  if (c.status !== 201) {
    throw new Error(`challenge failed for ${address}: ${JSON.stringify(c.body)}`);
  }
  return {
    challengeId: c.body.challengeId,
    message: c.body.message,
    signature: signMessageForTesting(c.body.message, hexToBin(privateKeyHex))
  };
}

export async function signIn(
  client: ApiClient,
  address: string,
  privateKeyHex: string
): Promise<Session> {
  const { challengeId, signature } = await signChallenge(client, address, privateKeyHex);
  const v = await client.api("/auth/verify", {
    method: "POST",
    body: { challengeId, signature }
  });
  if (v.status === 200) {
    return { token: v.body.token as string, id: v.body.user.id as string, address };
  }

  if (v.status !== 409 || v.body?.registerable !== true) {
    throw new Error(`sign-in failed for ${address}: ${v.status} ${JSON.stringify(v.body)}`);
  }

  // A fresh challenge, because the one above is spent. Reusing it would be
  // rejected with 409 "already used" and the test would read as a registration
  // bug rather than as the single-use rule doing its job. This is also what a
  // real client has to do, which is the point of testing it this way.
  const reg = await signChallenge(client, address, privateKeyHex);
  const { username, email } = identityFor(address);
  const r = await client.api("/auth/register", {
    method: "POST",
    body: {
      challengeId: reg.challengeId,
      signature: reg.signature,
      username,
      email,
      password: TEST_PASSWORD
    }
  });
  if (r.status !== 201) {
    throw new Error(`registration failed for ${address}: ${r.status} ${JSON.stringify(r.body)}`);
  }
  return { token: r.body.token as string, id: r.body.user.id as string, address };
}
