/**
 * End-to-end smoke test for the auth flow against a real API process and a
 * real PostgreSQL database.
 *
 * It boots the API on its own port, drives /auth/challenge and /auth/verify
 * for each of the three generated test wallets by signing the challenge with
 * that wallet's private key, and asserts the security properties that matter:
 *
 *   - a correct signature mints a session and creates the user
 *   - a challenge cannot be replayed (single use)
 *   - a signature from the wrong wallet is rejected
 *   - a valid token works, and logout invalidates it
 *
 * It also queries PostgreSQL directly to confirm the rows were really written
 * rather than cached in the API process.
 *
 * The wallets live in data/test-wallets.json and are git-ignored. This is the
 * same "simulate a wallet with a raw key" path the later escrow and RepID
 * tests use.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { randomBytes } from "node:crypto";
import {
  secp256k1,
  hash160,
  hexToBin,
  encodeCashAddress,
  CashAddressType
} from "@bitauth/libauth";
import { signMessageForTesting } from "../src/utils/bch-message.js";
import { TEST_PASSWORD, makeIdentity, signChallenge, signIn } from "./lib/smoke-auth.js";

/**
 * A wallet that has never been seen before, so its account state is known:
 * no account exists, therefore registration is guaranteed to succeed.
 *
 * The suite's shared test wallets cannot play this part. They were registered by
 * an earlier run and carry accounts with a different email, so tests that assert
 * on a fresh registration would pass or fail depending on database history.
 * Deriving the key on the spot costs nothing and makes the fixture independent
 * of whatever is already there.
 */
function generateFreshWallet(role: string): TestWallet {
  let priv: Uint8Array;
  do {
    priv = new Uint8Array(randomBytes(32));
  } while (!secp256k1.validatePrivateKey(priv));
  // The overloads of derivePublicKeyCompressed return either a hex string or
  // bytes depending on which argument form is used; only the bytes form is
  // valid here, so the string case is rejected rather than cast away.
  const publicKey = secp256k1.derivePublicKeyCompressed(priv);
  if (typeof publicKey === "string") {
    throw new Error("derivePublicKeyCompressed returned hex unexpectedly");
  }
  const pkh = hash160(publicKey);
  return {
    role,
    address: encodeCashAddress({ payload: pkh, prefix: "bchtest", type: CashAddressType.p2pkh }).address,
    privateKeyHex: Buffer.from(priv).toString("hex")
  };
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");
const walletsPath = join(repoRoot, "data", "test-wallets.json");

/**
 * Resolves tsx's CLI entry point and runs it with the current node binary.
 * Going through process.execPath avoids depending on `npx`, which is a
 * `.cmd` shim on Windows and therefore not spawnable without a shell.
 */
function tsxCommand(): { command: string; args: string[] } {
  const require = createRequire(import.meta.url);
  const manifest = require.resolve("tsx/package.json");
  const pkg = JSON.parse(readFileSync(manifest, "utf8")) as { bin: string | Record<string, string> };
  const bin = typeof pkg.bin === "string" ? pkg.bin : Object.values(pkg.bin)[0];
  return { command: process.execPath, args: [resolve(dirname(manifest), bin)] };
}

const PORT = Number(process.env.SMOKE_PORT ?? 4111);
const BASE = `http://127.0.0.1:${PORT}`;

interface TestWallet {
  role: string;
  address: string;
  privateKeyHex: string;
}

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail = "") {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function api(
  path: string,
  options: { method?: string; body?: unknown; token?: string } = {}
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE}${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function waitForApi(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.status === 200) return true;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function main() {
  if (!existsSync(walletsPath)) {
    console.error(`No wallet file at ${walletsPath}. Run generate:wallets first.`);
    process.exit(1);
  }
  const { wallets } = JSON.parse(readFileSync(walletsPath, "utf8")) as { wallets: TestWallet[] };

  const { command, args: tsxArgs } = tsxCommand();
  const server: ChildProcess = spawn(
    command,
    [...tsxArgs, "--env-file-if-exists=../../.env", "src/index.ts"],
    {
      cwd: resolve(__dirname, ".."),
      env: { ...process.env, PORT: String(PORT) },
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  const serverLog: string[] = [];
  server.stdout?.on("data", (d) => serverLog.push(String(d)));
  server.stderr?.on("data", (d) => serverLog.push(String(d)));
  // Without this listener an ENOENT on spawn surfaces as an unhandled 'error'
  // event and kills the process before the finally block can report anything.
  server.on("error", (err) => serverLog.push(`spawn failed: ${err.message}`));

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    if (!(await waitForApi(90_000))) {
      console.error("API did not become healthy in time.\n" + serverLog.join(""));
      process.exit(1);
    }

    console.log("\nhealth");
    const health = await api("/health");
    check("GET /health returns 200", health.status === 200);
    check("database dependency ok", health.body.dependencies.database.ok === true);
    check("electrum dependency ok", health.body.dependencies.electrum.ok === true);

    console.log("\nverify does not create accounts");
    const fresh = generateFreshWallet("fresh");
    const { username, email } = makeIdentity(fresh.address);
    const firstProof = await signChallenge({ api }, fresh.address, fresh.privateKeyHex);
    const orphan = await api("/auth/verify", {
      method: "POST",
      body: { challengeId: firstProof.challengeId, signature: firstProof.signature }
    });
    check(
      "a wallet with no account gets 409 and is told it can register",
      orphan.status === 409 && orphan.body?.registerable === true,
      `got ${orphan.status} ${JSON.stringify(orphan.body)}`
    );
    check("the 409 carries no session token", orphan.body?.token === undefined);
    check(
      "verify never creates anything (no 201)",
      orphan.status !== 201,
      `got ${orphan.status}`
    );
    const usersAfterVerify = await pool.query(
      "SELECT count(*)::int AS n FROM users WHERE active_wallet_address = $1",
      [fresh.address]
    );
    check("no account row was created for the wallet", usersAfterVerify.rows[0].n === 0);

    console.log("\nchallenge basics");
    const c = await api("/auth/challenge", {
      method: "POST",
      body: { walletAddress: fresh.address, purpose: "sign-in" }
    });
    check("POST /auth/challenge returns 201", c.status === 201, `got ${c.status}`);
    check("challenge carries a message to sign", typeof c.body.message === "string");
    check("challenge echoes the purpose it was issued for", c.body.purpose === "sign-in");
    check(
      "the message states what is being authorised",
      typeof c.body.message === "string" && c.body.message.includes("sign in")
    );
    const badPurpose = await api("/auth/challenge", {
      method: "POST",
      body: { walletAddress: fresh.address, purpose: "steal-money" }
    });
    check("an unknown purpose is refused", badPurpose.status === 400, `got ${badPurpose.status}`);

    console.log("\nregistration (the only way an account comes into existence)");
    const challenge = await signChallenge({ api }, fresh.address, fresh.privateKeyHex);
    const signature = challenge.signature;
    const registered = await api("/auth/register", {
      method: "POST",
      body: {
        challengeId: challenge.challengeId,
        signature,
        username,
        email,
        password: TEST_PASSWORD
      }
    });
    check("POST /auth/register returns 201", registered.status === 201, JSON.stringify(registered.body));
    const token: string = registered.body.token;
    check("a session token is returned", typeof token === "string");
    check("the account has no roles yet", JSON.stringify(registered.body.user?.roles) === "[]");
    check("activeRole defaults to client", registered.body.user?.activeRole === "client");

    const user = await api("/auth/me", { token });
    check(
      "the account is linked to this wallet",
      user.status === 200 && user.body?.walletAddress === fresh.address
    );
    check("the account has exactly one wallet so far", user.body?.wallets?.length === 1, `got ${user.body?.wallets?.length}`);
    check("the account reports a password", user.body?.hasPassword === true);
    check("the account has the username and email it registered with", user.body?.username === username && user.body?.email === email);

    console.log("\nregistration refuses duplicates and bad input");
    const dupeWallet = await signChallenge({ api }, fresh.address, fresh.privateKeyHex);
    const dupe = await api("/auth/register", {
      method: "POST",
      body: {
        challengeId: dupeWallet.challengeId,
        signature: dupeWallet.signature,
        username: "someoneelse",
        email: "someoneelse@example.test",
        password: TEST_PASSWORD
      }
    });
    check("a second account on the same wallet is refused", dupe.status === 409, `got ${dupe.status}`);

    const dupeEmail = generateFreshWallet("dupe-email");
    const dupeEmailProof = await signChallenge({ api }, dupeEmail.address, dupeEmail.privateKeyHex);
    const dupeEmailRes = await api("/auth/register", {
      method: "POST",
      body: {
        challengeId: dupeEmailProof.challengeId,
        signature: dupeEmailProof.signature,
        username: "othername",
        email,
        password: TEST_PASSWORD
      }
    });
    check("a duplicate email is refused", dupeEmailRes.status === 400, `got ${dupeEmailRes.status}`);

    const dupeName = generateFreshWallet("dupe-name");
    const dupeNameProof = await signChallenge({ api }, dupeName.address, dupeName.privateKeyHex);
    const dupeNameRes = await api("/auth/register", {
      method: "POST",
      body: {
        challengeId: dupeNameProof.challengeId,
        signature: dupeNameProof.signature,
        username: username.toUpperCase(),
        email: "unused@example.test",
        password: TEST_PASSWORD
      }
    });
    check("a duplicate username is refused whatever its case", dupeNameRes.status === 400, `got ${dupeNameRes.status}`);

    for (const [label, body] of [
      ["a too-short password", { username: "validname", email: "valid1@example.test", password: "short" }],
      ["a whitespace-only password", { username: "validname", email: "valid2@example.test", password: "               " }],
      ["a malformed email", { username: "validname", email: "not-an-email", password: TEST_PASSWORD }],
      ["a username with spaces", { username: "has spaces", email: "valid3@example.test", password: TEST_PASSWORD }]
    ] as const) {
      const w = generateFreshWallet("invalid");
      const proof = await signChallenge({ api }, w.address, w.privateKeyHex);
      const res = await api("/auth/register", {
        method: "POST",
        body: { challengeId: proof.challengeId, signature: proof.signature, ...body }
      });
      check(`registration refuses ${label}`, res.status === 400, `got ${res.status}`);
    }

    const mainnet = await api("/auth/challenge", {
      method: "POST",
      body: { walletAddress: "bitcoincash1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqx2m3uh" }
    });
    check("a mainnet address is refused on Chipnet", mainnet.status === 400, `got ${mainnet.status}`);

    console.log("\nchallenge is single use");
    const replay = await api("/auth/register", {
      method: "POST",
      body: { challengeId: challenge.challengeId, signature, username, email, password: TEST_PASSWORD }
    });
    check("replaying a spent challenge returns 409", replay.status === 409, `got ${replay.status}`);

    console.log("\nsignature must come from the challenged wallet");
    const other = generateFreshWallet("other");
    const c2 = await signChallenge({ api }, fresh.address, fresh.privateKeyHex);
    const wrongSig = signMessageForTesting(c2.message, hexToBin(other.privateKeyHex));
    const wrong = await api("/auth/verify", {
      method: "POST",
      body: { challengeId: c2.challengeId, signature: wrongSig }
    });
    check("a signature from another wallet returns 401", wrong.status === 401, `got ${wrong.status}`);

    console.log("\nsession token lifecycle");
    const me = await api("/auth/me", { token });
    check("GET /auth/me with a valid token returns the user", me.status === 200 && me.body.walletAddress === fresh.address);
    const noAuth = await api("/auth/me");
    check("GET /auth/me without a token returns 401", noAuth.status === 401, `got ${noAuth.status}`);
    const badAuth = await api("/auth/me", { token: "not-a-real-token" });
    check("GET /auth/me with a bogus token returns 401", badAuth.status === 401, `got ${badAuth.status}`);

    const logout = await api("/auth/logout", { method: "POST", token });
    check("POST /auth/logout returns 204", logout.status === 204, `got ${logout.status}`);
    const afterLogout = await api("/auth/me", { token });
    check("the token stops working after logout", afterLogout.status === 401, `got ${afterLogout.status}`);

    console.log("\nall three shared test wallets can sign in");
    for (const w of wallets) {
      const session = await signIn({ api }, w.address, w.privateKeyHex);
      check(`${w.role} signs in`, session.id.length > 0);
    }

    // Everything from here needs a live session, and the one above was just
    // logged out — so a fresh one is taken. Reusing the revoked token would
    // make every later assertion fail with 401 and read like a broken
    // password route rather than an expired session.
    const live = await signIn({ api }, fresh.address, fresh.privateKeyHex);
    const liveToken = live.token;

    console.log("\npassword sign-in");
    const login = await api("/auth/login", { method: "POST", body: { email, password: TEST_PASSWORD } });
    check("POST /auth/login returns 200", login.status === 200, `got ${login.status} ${JSON.stringify(login.body)}`);
    check("login returns a session token", typeof login.body?.token === "string");
    check("login resolves the same account", login.body?.user?.id === user.body?.id);
    const passwordToken = login.body?.token as string | undefined;

    const wrongPassword = await api("/auth/login", {
      method: "POST",
      body: { email, password: "not-the-password" }
    });
    check("a wrong password returns 401", wrongPassword.status === 401, `got ${wrongPassword.status}`);

    // The same wording for both, so the response cannot be used to find out
    // which addresses have accounts.
    const unknownEmail = await api("/auth/login", {
      method: "POST",
      body: { email: "nobody@nowhere.invalid", password: "whatever-it-is" }
    });
    check(
      "an unknown email and a wrong password give the same message",
      unknownEmail.status === wrongPassword.status &&
        unknownEmail.body?.error === wrongPassword.body?.error,
      `${unknownEmail.body?.error} vs ${wrongPassword.body?.error}`
    );

    // Case handling: the index is on lower(email), so the login form has to
    // normalise too or `Ana@x.com` would be a different key from `ana@x.com`.
    const upperEmail = await api("/auth/login", {
      method: "POST",
      body: { email: email.toUpperCase(), password: TEST_PASSWORD }
    });
    check("login is case-insensitive on the email", upperEmail.status === 200, `got ${upperEmail.status}`);

    if (passwordToken) {
      const meByPassword = await api("/auth/me", { token: passwordToken });
      check("a password session works like any other", meByPassword.status === 200);
    }

    console.log("\nchanging a password");
    const newPassword = "smoke-test-password-2";
    const noCurrent = await api("/auth/password", {
      method: "POST",
      body: { newPassword },
      token: liveToken
    });
    check(
      "changing a password without the current one returns 403",
      noCurrent.status === 403,
      `got ${noCurrent.status}`
    );

    const changed = await api("/auth/password", {
      method: "POST",
      body: { currentPassword: TEST_PASSWORD, newPassword },
      token: liveToken
    });
    check("changing the password with the current one succeeds", changed.status === 200, `got ${changed.status}`);

    const oldPw = await api("/auth/login", { method: "POST", body: { email, password: TEST_PASSWORD } });
    check("the old password no longer works", oldPw.status === 401, `got ${oldPw.status}`);
    const newPw = await api("/auth/login", { method: "POST", body: { email, password: newPassword } });
    check("the new password works", newPw.status === 200, `got ${newPw.status}`);

    const weakChange = await api("/auth/password", {
      method: "POST",
      body: { currentPassword: newPassword, newPassword: "tiny" },
      token: liveToken
    });
    check("changing to a too-weak password is refused", weakChange.status === 400, `got ${weakChange.status}`);

    console.log("\nchallenge purpose cannot be swapped");
    const signInPurpose = await signChallenge({ api }, fresh.address, fresh.privateKeyHex, "sign-in");
    const replayedAsLink = await api("/users/me/wallets", {
      method: "POST",
      body: { challengeId: signInPurpose.challengeId, signature: signInPurpose.signature },
      token: liveToken
    });
    check(
      "a sign-in signature cannot be used to link a wallet",
      replayedAsLink.status === 400,
      `got ${replayedAsLink.status}`
    );

    console.log("\nsecond wallet on the same account");
    const second = generateFreshWallet("second");
    const linkProof = await signChallenge({ api }, second.address, second.privateKeyHex, "link-wallet");
    check(
      "the link-wallet message says what it is for",
      linkProof.message.includes("add this wallet"),
      linkProof.message
    );
    const linked = await api("/users/me/wallets", {
      method: "POST",
      body: { challengeId: linkProof.challengeId, signature: linkProof.signature },
      token: liveToken
    });
    check("linking a second wallet returns 201", linked.status === 201, JSON.stringify(linked.body));
    check("the account now has two wallets", linked.body?.wallets?.length === 2, `got ${linked.body?.wallets?.length}`);
    check(
      "exactly one wallet is marked active",
      linked.body?.wallets?.filter((w: { active: boolean }) => w.active).length === 1
    );
    check("the active wallet did not change by linking", linked.body?.walletAddress === fresh.address);

    const secondSession = await signIn({ api }, second.address, second.privateKeyHex);
    check(
      "the second wallet reaches the same account",
      secondSession.id === live.id,
      `${secondSession.id} vs ${live.id}`
    );

    console.log("\nswitching the active wallet");
    const activate = await api("/users/me/active-wallet", {
      method: "POST",
      body: { address: second.address },
      token: liveToken
    });
    check("activating a linked wallet succeeds", activate.status === 200, JSON.stringify(activate.body));
    check("walletAddress follows the switch", activate.body?.walletAddress === second.address);
    check(
      "the switch is reflected in the active flag",
      activate.body?.wallets?.find((w: { address: string }) => w.address === second.address)?.active === true &&
        activate.body?.wallets?.find((w: { address: string }) => w.address === fresh.address)?.active === false
    );

    const stranger = generateFreshWallet("stranger");
    const strangerSession = await signIn({ api }, stranger.address, stranger.privateKeyHex);
    // The meaningful case is reaching for *somebody else's* wallet. Asking to
    // re-activate your own current wallet is a harmless no-op and should succeed,
    // so testing that instead would assert nothing.
    const notMine = await api("/users/me/active-wallet", {
      method: "POST",
      body: { address: second.address },
      token: strangerSession.token
    });
    // This is the check that matters for the active wallet: setting it must not
    // accept an address that is not on the caller's own account, or one account
    // could point its "active" wallet at a key that belongs to somebody else.
    check("activating a wallet that is not yours is refused", notMine.status === 422, `got ${notMine.status}`);
    const strangerMe = await api("/auth/me", { token: strangerSession.token });
    check("the refused switch left the active wallet alone", strangerMe.body?.walletAddress === stranger.address);

    const ownNoop = await api("/users/me/active-wallet", {
      method: "POST",
      body: { address: stranger.address },
      token: strangerSession.token
    });
    check("re-activating your own active wallet is a harmless no-op", ownNoop.status === 200, `got ${ownNoop.status}`);

    // The database refuses this too, not just the route. A test that only proves
    // the route's check works would still pass if somebody later deleted that
    // check and relied on the constraint — or the reverse.
    //
    // The statement is run directly against PostgreSQL precisely to bypass the
    // route, and a foreign key violation is raised as an error rather than
    // reported as zero rows affected, so the failure is caught and asserted on.
    let fkHeld = false;
    try {
      await pool.query(
        "UPDATE users SET active_wallet_address = $1 WHERE active_wallet_address = $2",
        [second.address, stranger.address]
      );
    } catch (err) {
      fkHeld = /users_active_wallet_fk/.test((err as Error).message);
    }
    check("the foreign key refuses a cross-account active wallet in the database too", fkHeld);

    console.log("\nactive role is a preference, not a permission");
    const asFreelancer = await api("/users/me/active-role", {
      method: "POST",
      body: { activeRole: "freelancer" },
      token: liveToken
    });
    check("switching active role succeeds", asFreelancer.status === 200, JSON.stringify(asFreelancer.body));
    check("the new active role is returned", asFreelancer.body?.activeRole === "freelancer");
    const backToClient = await api("/users/me/active-role", {
      method: "POST",
      body: { activeRole: "arbiter" },
      token: liveToken
    });
    check("an invalid active role is refused", backToClient.status === 400, `got ${backToClient.status}`);

    // The point of the above: a freelancer-mode user can still hire. The role is
    // a display preference, and treating it as a gate would block a real user
    // from posting a job without them first flipping a switch.
    const jobWhileFreelancer = await api("/jobs", {
      method: "POST",
      token: liveToken,
      body: { title: "posted in freelancer mode", description: "should still work", budgetSats: 10_000 }
    });
    check("a user in freelancer mode can still post a job", jobWhileFreelancer.status === 201, JSON.stringify(jobWhileFreelancer.body));

    console.log("\nno text minimum, but no empty text either");
    // Short text is fine — that was the point of removing the 8/30 minimums.
    // What must still fail is text that is *absent* or only whitespace, which
    // would otherwise produce a job with a blank title in the board.
    for (const [label, body] of [
      ["a one-character title", { title: "x", description: "d", budgetSats: 1000 }],
      ["a one-word title", { title: "Fix", description: "One line", budgetSats: 1000 }],
      ["a one-character description", { title: "Real title", description: "d", budgetSats: 1000 }]
    ] as const) {
      const res = await api("/jobs", { method: "POST", token: liveToken, body });
      check(`posting a job with ${label} is accepted`, res.status === 201, `got ${res.status}`);
    }
    for (const [label, body] of [
      ["a missing title", { description: "ok", budgetSats: 1000 }],
      ["a missing description", { title: "ok title", budgetSats: 1000 }],
      ["a whitespace-only title", { title: "   ", description: "ok", budgetSats: 1000 }],
      ["a whitespace-only description", { title: "ok title", description: "\t\n  ", budgetSats: 1000 }],
      ["a non-string title", { title: 42, description: "ok", budgetSats: 1000 }]
    ] as const) {
      const res = await api("/jobs", { method: "POST", token: liveToken, body });
      check(`posting a job with ${label} is refused`, res.status === 400, `got ${res.status}`);
    }
    const trimmedJob = await api("/jobs", {
      method: "POST",
      token: liveToken,
      body: { title: "  spaced  ", description: "  also spaced  ", budgetSats: 1000 }
    });
    check(
      "surrounding whitespace is trimmed rather than stored",
      trimmedJob.status === 201 && trimmedJob.body?.title === "spaced" && trimmedJob.body?.description === "also spaced",
      JSON.stringify(trimmedJob.body)
    );
    const tooLong = await api("/jobs", {
      method: "POST",
      token: liveToken,
      body: { title: "x".repeat(5000), description: "ok", budgetSats: 1000 }
    });
    check("an over-long title is refused", tooLong.status === 400, `got ${tooLong.status}`);

    console.log("\nrows actually persisted in PostgreSQL");
    const users = await pool.query("SELECT wallet_address FROM users WHERE wallet_address = ANY($1::text[])", [
      wallets.map((w) => w.address)
    ]);
    check(
      "all three wallets exist in the users table",
      users.rows.length === wallets.length,
      `found ${users.rows.length} of ${wallets.length}`
    );
    const walletRows = await pool.query(
      "SELECT count(*)::int AS n FROM user_wallets WHERE address = ANY($1::text[])",
      [wallets.map((w) => w.address)]
    );
    check(
      "every account has a row in user_wallets",
      walletRows.rows[0].n >= wallets.length,
      `found ${walletRows.rows[0].n}`
    );
    const hashed = await pool.query("SELECT password_hash FROM users WHERE id = $1", [live.id]);
    check(
      "the password is stored as an argon2id hash",
      typeof hashed.rows[0]?.password_hash === "string" &&
        hashed.rows[0].password_hash.startsWith("$argon2id$")
    );
    check("the plaintext password is nowhere in the row", !JSON.stringify(hashed.rows[0]).includes(newPassword));

    const liveSessions = await pool.query(
      "SELECT count(*)::int AS n FROM sessions WHERE expires_at > now()"
    );
    check("live sessions are present in the sessions table", liveSessions.rows[0].n >= 3, `found ${liveSessions.rows[0].n}`);
    const methods = await pool.query("SELECT auth_method FROM sessions WHERE user_id = $1", [live.id]);
    check(
      "sessions record how they were established",
      methods.rows.some((r) => r.auth_method === "wallet") && methods.rows.some((r) => r.auth_method === "password"),
      JSON.stringify(methods.rows.map((r) => r.auth_method))
    );
    const usedChallenges = await pool.query(
      "SELECT count(*)::int AS n FROM auth_challenges WHERE used_at IS NOT NULL"
    );
    check("used challenges are marked used_at", usedChallenges.rows[0].n >= 1, `found ${usedChallenges.rows[0].n}`);
  } finally {
    await pool.end().catch(() => {});
    server.kill();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
