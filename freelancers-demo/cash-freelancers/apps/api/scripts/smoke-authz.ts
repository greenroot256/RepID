/**
 * Authorization regression test.
 *
 * Before this, seven mutating endpoints accepted unauthenticated requests and
 * took the acting user from the request body. That included the rating
 * endpoint (anyone could file a reputation rating as anyone else) and the
 * two-step escrow signing endpoints (anyone could write a pending signature or
 * mark an escrow released). This asserts the fixed behaviour for every one of
 * them, plus the ownership checks that authentication alone does not provide.
 *
 * Runs against a real API process and a real PostgreSQL database, with the
 * three throwaway Chipnet wallets from data/test-wallets.json plus a fourth
 * generated here to act as an unrelated third party.
 *
 * Run with: pnpm --filter api smoke:authz
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import {
  secp256k1,
  hash160,
  hexToBin,
  encodeCashAddress,
  CashAddressType
} from "@bitauth/libauth";
import { signMessageForTesting } from "../src/utils/bch-message.js";
import { signIn as smokeSignIn, signChallenge, makeIdentity } from "./lib/smoke-auth.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");
const walletsPath = join(repoRoot, "data", "test-wallets.json");

const PORT = Number(process.env.SMOKE_PORT ?? 4112);
const BASE = `http://127.0.0.1:${PORT}`;

let passed = 0;
let failed = 0;
let skipped = 0;
let currentSection = "";

function section(name: string) {
  currentSection = name;
  console.log(`\n${name}`);
}

function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/**
 * For assertions that depend on an external service (Electrum) which can be
 * unreachable for reasons that have nothing to do with the code under test.
 * Recorded as skipped rather than passed, so a green run never hides an
 * unverified claim.
 */
function skip(name: string, reason: string) {
  skipped++;
  console.log(`  SKIP  ${name} — ${reason}`);
}

function expectStatus(label: string, actual: number, expected: number, body: any) {
  check(
    `${label} → ${expected}`,
    actual === expected,
    `got ${actual}${body ? ` (${JSON.stringify(body).slice(0, 120)})` : ""}`
  );
}

interface TestWallet {
  role: string;
  address: string;
  privateKeyHex: string;
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

async function signIn(address: string, privateKeyHex: string) {
  return smokeSignIn({ api }, address, privateKeyHex);
}

function tsxCommand(): { command: string; args: string[] } {
  const require = createRequire(import.meta.url);
  const manifest = require.resolve("tsx/package.json");
  const pkg = JSON.parse(readFileSync(manifest, "utf8")) as { bin: string | Record<string, string> };
  const bin = typeof pkg.bin === "string" ? pkg.bin : Object.values(pkg.bin)[0];
  return { command: process.execPath, args: [resolve(dirname(manifest), bin)] };
}

/** A fourth wallet, not party to anything, to prove the ownership checks. */
function generateOutsider(): TestWallet {
  let priv: Uint8Array;
  do {
    priv = new Uint8Array(randomBytes(32));
  } while (!secp256k1.validatePrivateKey(priv));
  // Only the bytes form of the return value is valid input to hash160; the
  // string overload is rejected rather than cast away.
  const publicKey = secp256k1.derivePublicKeyCompressed(priv);
  if (typeof publicKey === "string") {
    throw new Error("derivePublicKeyCompressed returned hex unexpectedly");
  }
  const pkh = hash160(publicKey);
  return {
    role: "outsider",
    address: encodeCashAddress({ payload: pkh, prefix: "bchtest", type: CashAddressType.p2pkh }).address,
    privateKeyHex: Buffer.from(priv).toString("hex")
  };
}

async function main() {
  if (!existsSync(walletsPath)) {
    console.error(`No wallet file at ${walletsPath}. Run generate:wallets first.`);
    process.exit(1);
  }
  const { wallets } = JSON.parse(readFileSync(walletsPath, "utf8")) as { wallets: TestWallet[] };

  const { command, args: tsxArgs } = tsxCommand();
  // Fixture-only database handle, used to stand in for an on-chain funding that
  // this test cannot produce without spending real coins. Nothing here asserts
  // anything about the chain; it only sets up a preconditions fixture.
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
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
  server.on("error", (err) => serverLog.push(`spawn failed: ${err.message}`));

  try {
    const deadline = Date.now() + 90_000;
    let up = false;
    while (Date.now() < deadline && !up) {
      try {
        up = (await fetch(`${BASE}/health`)).status === 200;
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    if (!up) {
      console.error("API did not become healthy.\n" + serverLog.join(""));
      process.exit(1);
    }

    const client = await signIn(wallets[0].address, wallets[0].privateKeyHex);
    const freelancer = await signIn(wallets[1].address, wallets[1].privateKeyHex);
    const arbiter = await signIn(wallets[2].address, wallets[2].privateKeyHex);
    const outsiderWallet = generateOutsider();
    const outsider = await signIn(outsiderWallet.address, outsiderWallet.privateKeyHex);

    /*
     * The multi-wallet fixtures below deliberately reuse wallets[1] as a second
     * wallet on the client's account. They are created and destroyed per run in
     * dependency order, and the teardown comes first so that a failure later in
     * the run cannot leave a wallet attached to two accounts — the unique index
     * on user_wallets.address would then break the *next* run's registration,
     * which is a much more confusing failure than the one that caused it.
     */

    // --- Fixture: a job with a freelancer, and one escrow of each mode ---
    const job = await api("/jobs", {
      method: "POST",
      token: client.token,
      body: { title: "authz fixture", description: "authorization regression", budgetSats: 50_000 }
    });
    if (job.status !== 201) throw new Error(`fixture job failed: ${JSON.stringify(job.body)}`);
    await api(`/jobs/${job.body.id}/assign-freelancer`, {
      method: "POST",
      token: client.token,
      body: { freelancerId: freelancer.id }
    });

    // The arbiter must hold the `arbiter` role before an arbitrated escrow can
    // reference it. Setting a profile is what now grants it.
    await api(`/users/${arbiter.id}/arbiter-profile`, {
      method: "POST",
      token: arbiter.token,
      body: { feeBps: 100, bio: "test arbiter" }
    });

    const timeoutAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    const bilateral = await api("/escrows", {
      method: "POST",
      token: client.token,
      body: { jobId: job.body.id, mode: "bilateral", amountSats: 40_000, timeoutAt }
    });
    if (bilateral.status !== 201) throw new Error(`fixture bilateral failed: ${JSON.stringify(bilateral.body)}`);

    // A second job so the arbitrated escrow has its own (one escrow per job).
    const job2 = await api("/jobs", {
      method: "POST",
      token: client.token,
      body: { title: "authz fixture 2", description: "authorization regression", budgetSats: 50_000 }
    });
    await api(`/jobs/${job2.body.id}/assign-freelancer`, {
      method: "POST",
      token: client.token,
      body: { freelancerId: freelancer.id }
    });
    const arbitrated = await api("/escrows", {
      method: "POST",
      token: client.token,
      body: { jobId: job2.body.id, mode: "arbitrated", amountSats: 40_000, arbiterId: arbiter.id }
    });
    if (arbitrated.status !== 201) throw new Error(`fixture arbitrated failed: ${JSON.stringify(arbitrated.body)}`);

    const bilateralId = bilateral.body.id;
    const arbitratedId = arbitrated.body.id;

    // A plausible 400-byte transaction hex; these routes only check shape.
    const fakeTxHex = "0200000001" + "ab".repeat(180) + "00000000";

    // --------------------------------------------------- public job board
    section("GET /jobs — the public board, and its filters");
    {
      const anonymous = await api("/jobs");
      expectStatus("no token", anonymous.status, 200, anonymous.body);
      check("returns an array", Array.isArray(anonymous.body), typeof anonymous.body);

      const filtered = await api("/jobs?category=Design");
      expectStatus("category=Design", filtered.status, 200, filtered.body);
      check(
        "every returned job really has that category",
        Array.isArray(filtered.body) && filtered.body.every((j: any) => j.category === "Design")
      );

      const badCategory = await api("/jobs?category=NotACategory");
      expectStatus("an unknown category", badCategory.status, 400, badCategory.body);

      const badStatus = await api("/jobs?status=not-a-status");
      expectStatus("an unknown status", badStatus.status, 400, badStatus.body);

      // The board has to stay bounded no matter what the caller asks for.
      const huge = await api("/jobs?limit=100000");
      expectStatus("limit=100000", huge.status, 200, huge.body);
      check(
        "the limit is capped at 100 rows",
        Array.isArray(huge.body) && huge.body.length <= 100,
        `got ${huge.body?.length}`
      );

      const badOffset = await api("/jobs?offset=-5&limit=10");
      expectStatus("a negative offset", badOffset.status, 200, badOffset.body);
    }

    // -------------------------------------------------- bidding and roles
    section("proposals — self-dealing, and what counts as being able to bid");
    {
      // A job with no freelancer, so the only thing standing between the client
      // and an accepted bid is the guards themselves.
      const openJob = await api("/jobs", {
        method: "POST",
        token: client.token,
        body: { title: "open for bids", description: "still taking proposals", budgetSats: 30_000 }
      });
      if (openJob.status !== 201) {
        throw new Error(`open job fixture failed: ${JSON.stringify(openJob.body)}`);
      }

      const selfBid = await api(`/jobs/${openJob.body.id}/proposals`, {
        method: "POST",
        token: client.token,
        body: { proposedAmountSats: 20_000 }
      });
      // The client hiring themselves would produce an escrow between one party
      // paying another, which the bilateral covenant would accept without
      // question. Refused at the only point where the relationship is knowable.
      expectStatus("the client bidding on their own job", selfBid.status, 403, selfBid.body);

      const selfAssign = await api(`/jobs/${openJob.body.id}/assign-freelancer`, {
        method: "POST",
        token: client.token,
        body: { freelancerId: client.id }
      });
      expectStatus("the client assigning themselves", selfAssign.status, 403, selfAssign.body);

      const missingFreelancer = await api(`/jobs/${openJob.body.id}/assign-freelancer`, {
        method: "POST",
        token: client.token,
        body: { freelancerId: "00000000-0000-0000-0000-000000000000" }
      });
      expectStatus("assigning a user who does not exist", missingFreelancer.status, 404, missingFreelancer.body);

      const outsiderAssign = await api(`/jobs/${openJob.body.id}/assign-freelancer`, {
        method: "POST",
        token: outsider.token,
        body: { freelancerId: freelancer.id }
      });
      expectStatus("a non-client assigning", outsiderAssign.status, 403, outsiderAssign.body);

      const goodBid = await api(`/jobs/${openJob.body.id}/proposals`, {
        method: "POST",
        token: freelancer.token,
        body: { proposedAmountSats: 20_000, message: "I can do this" }
      });
      check("a freelancer can bid on an open job", goodBid.status === 201, JSON.stringify(goodBid.body));

      const noMessage = await api(`/jobs/${openJob.body.id}/proposals`, {
        method: "POST",
        token: outsider.token,
        body: { proposedAmountSats: 15_000 }
      });
      // A message is optional: the amount is the bid, and requiring prose to
      // accompany it would be a content rule, not a safety one.
      check("a proposal with no message is accepted", noMessage.status === 201, JSON.stringify(noMessage.body));

      const blankMessage = await api(`/jobs/${openJob.body.id}/proposals`, {
        method: "POST",
        token: arbiter.token,
        body: { proposedAmountSats: 15_000, message: "   " }
      });
      check(
        "a whitespace-only message is stored as absent, not as blanks",
        blankMessage.status === 201 && !blankMessage.body?.message,
        `${blankMessage.status} ${JSON.stringify(blankMessage.body?.message)}`
      );

      for (const [label, body] of [
        ["a missing amount", { message: "hi" }],
        ["a zero amount", { proposedAmountSats: 0 }],
        ["a negative amount", { proposedAmountSats: -100 }],
        ["a fractional amount", { proposedAmountSats: 1.5 }],
        ["a non-numeric amount", { proposedAmountSats: "1000" }]
      ] as const) {
        const res = await api(`/jobs/${openJob.body.id}/proposals`, {
          method: "POST",
          token: outsider.token,
          body
        });
        check(`a proposal with ${label} is refused`, res.status === 400, `got ${res.status}`);
      }

      // The fixture job already has a freelancer assigned, so it is no longer
      // open for bids even though it is still in the "open" status.
      const bidOnTakenJob = await api(`/jobs/${job.body.id}/proposals`, {
        method: "POST",
        token: outsider.token,
        body: { proposedAmountSats: 20_000 }
      });
      check(
        "a job that already has a freelancer stops accepting bids",
        bidOnTakenJob.status === 403,
        `got ${bidOnTakenJob.status}`
      );

      const proposalsNoAuth = await api(`/jobs/${openJob.body.id}/proposals`, { method: "POST", body: { proposedAmountSats: 1 } });
      expectStatus("bidding with no token", proposalsNoAuth.status, 401, proposalsNoAuth.body);

      const acceptByOutsider = await api(`/proposals/${goodBid.body.id}/accept`, {
        method: "POST",
        token: outsider.token
      });
      expectStatus("accepting a proposal on someone else's job", acceptByOutsider.status, 403, acceptByOutsider.body);
    }

    section("activeRole — a preference that must not become a permission");
    {
      // The user with no job to post, so posting is unambiguously allowed.
      const switched = await api("/users/me/active-role", {
        method: "POST",
        token: outsider.token,
        body: { activeRole: "freelancer" }
      });
      check("switching active role to freelancer", switched.status === 200, JSON.stringify(switched.body));
      check("the new role comes back", switched.body?.activeRole === "freelancer");
      check(
        "the switch is persisted, not held in local state",
        (await api("/auth/me", { token: outsider.token })).body?.activeRole === "freelancer"
      );

      const stillCanHire = await api("/jobs", {
        method: "POST",
        token: outsider.token,
        body: { title: "hired while in freelancer mode", description: "allowed", budgetSats: 12_000 }
      });
      check(
        "a user in freelancer mode can still post a job",
        stillCanHire.status === 201,
        JSON.stringify(stillCanHire.body)
      );

      // And the reverse: someone who mostly bids can still hire. If activeRole
      // ever gated these routes, a real user would be locked out of half the
      // marketplace by a display preference.
      const backToClient = await api("/users/me/active-role", {
        method: "POST",
        token: outsider.token,
        body: { activeRole: "client" }
      });
      check("switching back to client", backToClient.status === 200, JSON.stringify(backToClient.body));

      for (const bad of ["arbiter", "admin", "", null, 42]) {
        const res = await api("/users/me/active-role", { method: "POST", token: outsider.token, body: { activeRole: bad } });
        expectStatus(`activeRole=${JSON.stringify(bad)}`, res.status, 400, res.body);
      }
      const noAuthRole = await api("/users/me/active-role", { method: "POST", body: { activeRole: "client" } });
      expectStatus("switching role with no token", noAuthRole.status, 401, noAuthRole.body);
    }

    section("job text — non-empty, but no length rules");
    {
      for (const [label, body, expected] of [
        ["a one-character title", { title: "x", description: "d", budgetSats: 1000 }, 201],
        ["a one-word title", { title: "Hi", description: "Ok", budgetSats: 1000 }, 201],
        ["a one-character description", { title: "Real", description: "d", budgetSats: 1000 }, 201],
        ["a missing title", { description: "d", budgetSats: 1000 }, 400],
        ["a missing description", { title: "t", budgetSats: 1000 }, 400],
        ["a whitespace-only title", { title: "  ", description: "d", budgetSats: 1000 }, 400],
        ["a whitespace-only description", { title: "t", description: "  ", budgetSats: 1000 }, 400],
        ["a non-string title", { title: 7, description: "d", budgetSats: 1000 }, 400],
        ["an over-long title", { title: "x".repeat(300), description: "d", budgetSats: 1000 }, 400]
      ] as const) {
        const res = await api("/jobs", { method: "POST", token: outsider.token, body });
        expectStatus(`posting a job with ${label}`, res.status, expected, res.body);
      }
      const noAuthJob = await api("/jobs", { method: "POST", body: { title: "t", description: "d", budgetSats: 1 } });
      expectStatus("posting a job with no token", noAuthJob.status, 401, noAuthJob.body);
    }

    // ------------------------------------------- per-user listing routes
    section("GET /jobs/mine and GET /escrows/mine — scoped to the caller");
    {
      const jobsNoAuth = await api("/jobs/mine");
      expectStatus("GET /jobs/mine with no token", jobsNoAuth.status, 401, jobsNoAuth.body);

      const escrowsNoAuth = await api("/escrows/mine");
      expectStatus("GET /escrows/mine with no token", escrowsNoAuth.status, 401, escrowsNoAuth.body);

      const clientJobs = await api("/jobs/mine", { token: client.token });
      expectStatus("as the client", clientJobs.status, 200, clientJobs.body);
      check(
        "the client's own posted job is listed",
        Array.isArray(clientJobs.body) && clientJobs.body.some((j: any) => j.id === job.body.id)
      );

      const freelancerJobs = await api("/jobs/mine", { token: freelancer.token });
      check(
        "the assigned freelancer sees the same job on their side",
        Array.isArray(freelancerJobs.body) && freelancerJobs.body.some((j: any) => j.id === job.body.id)
      );

      const outsiderJobs = await api("/jobs/mine", { token: outsider.token });
      // Asserted as "not the fixture jobs" rather than "empty", because the
      // sections above give the outsider jobs and bids of their own. The
      // property under test is scoping — the outsider must not see *these* two
      // jobs — and counting rows to zero would only pass on a clean database.
      check(
        "an unrelated user sees neither of them",
        Array.isArray(outsiderJobs.body) &&
          !outsiderJobs.body.some((j: any) => j.id === job.body.id || j.id === job2.body.id),
        `got ${outsiderJobs.body?.length}`
      );

      const clientEscrows = await api("/escrows/mine", { token: client.token });
      check(
        "the client is reported as the client of both escrows",
        Array.isArray(clientEscrows.body) &&
          clientEscrows.body.length >= 2 &&
          clientEscrows.body.every((e: any) => e.viewerRole === "client")
      );
      check(
        "each escrow carries the job title, so a list row is actionable",
        Array.isArray(clientEscrows.body) && clientEscrows.body.every((e: any) => typeof e.jobTitle === "string" && e.jobTitle.length > 0)
      );

      const freelancerEscrows = await api("/escrows/mine", { token: freelancer.token });
      check(
        "the freelancer is reported as the freelancer",
        Array.isArray(freelancerEscrows.body) &&
          freelancerEscrows.body.length >= 2 &&
          freelancerEscrows.body.every((e: any) => e.viewerRole === "freelancer")
      );

      const arbiterEscrows = await api("/escrows/mine", { token: arbiter.token });
      // Scoped to this run's fixture rather than to a total: this suite leaves
      // its fixtures in the database, so an exact count would only measure how
      // many times it had been run before.
      const arbiterRows = Array.isArray(arbiterEscrows.body) ? arbiterEscrows.body : [];
      const mineAsArbiter = arbiterRows.filter((e: any) => e.id === arbitratedId);
      check(
        "the arbiter sees the arbitrated fixture, and is reported as the arbiter",
        mineAsArbiter.length === 1 && mineAsArbiter[0].viewerRole === "arbiter",
        `got ${mineAsArbiter.length} rows for the fixture`
      );
      check(
        "the arbiter is not shown the bilateral escrow",
        !arbiterRows.some((e: any) => e.id === bilateralId)
      );

      const outsiderEscrows = await api("/escrows/mine", { token: outsider.token });
      check(
        "an unrelated user sees no escrows at all",
        Array.isArray(outsiderEscrows.body) && outsiderEscrows.body.length === 0
      );
    }

    // ------------------------------------- WalletConnect object encoding
    // These routes build a CashScript WC object whose byte fields are
    // Uint8Arrays and whose satoshi fields are bigints. Neither survives
    // JSON.stringify, and libauth's `stringify` renders them as the
    // human-readable placeholders "<Uint8Array: 0x…>" / "<bigint: 31000n>",
    // which a wallet cannot sign. The object has to reach the wire as hex.
    section("WalletConnect objects are JSON-encodable and wallet-readable");
    {
      /** Every byte field must be lowercase hex; no placeholder text. */
      function encodingIsUsable(wc: any): { ok: boolean; why: string } {
        if (!wc || typeof wc !== "object") return { ok: false, why: "missing wcTransactionObject" };
        if (!Array.isArray(wc.sourceOutputs) || wc.sourceOutputs.length === 0) {
          return { ok: false, why: "no sourceOutputs" };
        }
        const raw = JSON.stringify(wc);
        if (raw.includes("<Uint8Array") || raw.includes("<bigint")) {
          return { ok: false, why: "emitted a libauth placeholder" };
        }
        for (const so of wc.sourceOutputs) {
          for (const field of ["lockingBytecode", "unlockingBytecode", "outpointTransactionHash"]) {
            if (typeof so[field] !== "string" || !/^[0-9a-f]*$/.test(so[field])) {
              return { ok: false, why: `${field} is not lowercase hex` };
            }
          }
          if (!/^\d+$/.test(String(so.valueSatoshis))) {
            return { ok: false, why: `valueSatoshis is not a decimal string (${so.valueSatoshis})` };
          }
        }
        return { ok: true, why: "" };
      }

      // The covenant spends below can only be built against a contract that
      // actually holds its funding output, which this suite cannot produce
      // without broadcasting real coins. So the authorization behaviour is
      // asserted unconditionally (the older section covers it too) and the
      // encoding is asserted only when a funded contract exists.
      const release = await api(`/escrows/${bilateralId}/release-transaction`, { token: client.token });
      if (release.status === 200) {
        const verdict = encodingIsUsable(release.body.wcTransactionObject);
        check("the release object survives JSON as hex and decimal strings", verdict.ok, verdict.why);
      } else {
        skip(
          "the release object survives JSON as hex and decimal strings",
          `needs a funded covenant: ${JSON.stringify(release.body).slice(0, 100)}`
        );
      }

      const releaseAsFreelancer = await api(`/escrows/${bilateralId}/release-transaction`, {
        token: freelancer.token
      });
      expectStatus("release-transaction as the freelancer", releaseAsFreelancer.status, 403, releaseAsFreelancer.body);

      // Building the funding object reads the client's UTXOs from Electrum, so
      // this part is skipped (not failed) when the node is unreachable.
      const funding = await api(`/escrows/${bilateralId}/funding-transaction`, { token: client.token });
      if (funding.status === 200) {
        const verdict = encodingIsUsable(funding.body.wcTransactionObject);
        check("the funding object survives JSON as hex and decimal strings", verdict.ok, verdict.why);
        check(
          "the amount comes from the escrow record, not from the request",
          funding.body.amountSats === 40_000,
          `got ${funding.body.amountSats}`
        );
        check(
          "the UTXOs being spent are reported back for the wallet prompt",
          Array.isArray(funding.body.fundingUtxos) && funding.body.fundingUtxos.length > 0
        );
      } else {
        skip(
          "the funding object survives JSON as hex and decimal strings",
          `Electrum unreachable or wallet short: ${JSON.stringify(funding.body).slice(0, 120)}`
        );
      }

      const fundingNoAuth = await api(`/escrows/${bilateralId}/funding-transaction`);
      expectStatus("funding-transaction with no token", fundingNoAuth.status, 401, fundingNoAuth.body);

      const fundingAsFreelancer = await api(`/escrows/${bilateralId}/funding-transaction`, {
        token: freelancer.token
      });
      expectStatus(
        "funding-transaction as the freelancer",
        fundingAsFreelancer.status,
        403,
        fundingAsFreelancer.body
      );

      const spend = await api(
        `/escrows/${arbitratedId}/arbitrated-spend-transaction?outcome=release`,
        { token: client.token }
      );
      if (spend.status === 200) {
        const verdict = encodingIsUsable(spend.body.wcTransactionObject);
        check("the co-signing object survives JSON as hex and decimal strings", verdict.ok, verdict.why);
      } else {
        skip(
          "the co-signing object survives JSON as hex and decimal strings",
          `needs a funded covenant: ${JSON.stringify(spend.body).slice(0, 100)}`
        );
      }
    }

    // ---------------------------------------------------------------- ratings
    section("POST /jobs/:jobId/ratings — rater comes from the session");
    {
      const noAuth = await api(`/jobs/${job.body.id}/ratings`, {
        method: "POST",
        body: { rateeId: freelancer.id, score: 5 }
      });
      expectStatus("no token", noAuth.status, 401, noAuth.body);

      const outsiderAttempt = await api(`/jobs/${job.body.id}/ratings`, {
        method: "POST",
        token: outsider.token,
        body: { rateeId: freelancer.id, score: 1 }
      });
      expectStatus("a user who is not a party to the job", outsiderAttempt.status, 403, outsiderAttempt.body);

      // The old route took `raterId` from the body. It must no longer be
      // possible to rate as somebody else.
      const spoofed = await api(`/jobs/${job.body.id}/ratings`, {
        method: "POST",
        token: outsider.token,
        body: { raterId: client.id, rateeId: freelancer.id, score: 5 }
      });
      expectStatus("spoofing another user's raterId", spoofed.status, 403, spoofed.body);

      const selfRate = await api(`/jobs/${job.body.id}/ratings`, {
        method: "POST",
        token: client.token,
        body: { rateeId: client.id, score: 5 }
      });
      expectStatus("rating yourself", selfRate.status, 403, selfRate.body);

      const badScore = await api(`/jobs/${job.body.id}/ratings`, {
        method: "POST",
        token: client.token,
        body: { rateeId: freelancer.id, score: 9 }
      });
      expectStatus("a score of 9", badScore.status, 400, badScore.body);

      const good = await api(`/jobs/${job.body.id}/ratings`, {
        method: "POST",
        token: client.token,
        body: { rateeId: freelancer.id, score: 5 }
      });
      expectStatus("the client rating the freelancer", good.status, 201, good.body);
      check("the stored rater is the session user, not the body", good.body?.raterId === client.id, `raterId=${good.body?.raterId}`);
    }

    // ------------------------------------------------------------------ users
    section("POST /users — cannot pre-create another wallet's account");
    {
      const noAuth = await api("/users", {
        method: "POST",
        body: { displayName: "x", walletAddress: outsiderWallet.address, roles: ["arbiter"] }
      });
      expectStatus("no token", noAuth.status, 401, noAuth.body);

      const forOther = await api("/users", {
        method: "POST",
        token: outsider.token,
        body: { displayName: "hijack", walletAddress: client.address, roles: ["arbiter"] }
      });
      expectStatus("naming another wallet as your own", forOther.status, 403, forOther.body);

      const selfArbiter = await api("/users", {
        method: "POST",
        token: outsider.token,
        body: { displayName: "outsider", roles: ["arbiter"] }
      });
      expectStatus("self-granting the arbiter role", selfArbiter.status, 200, selfArbiter.body);
      check(
        "the response carries the caller's own wallet, not the body",
        selfArbiter.body?.walletAddress === outsiderWallet.address,
        `walletAddress=${selfArbiter.body?.walletAddress}`
      );
    }

    section("POST /users/:id/repid — only your own account");
    {
      const noAuth = await api(`/users/${client.id}/repid`, {
        method: "POST",
        body: { repIdAddress: outsiderWallet.address }
      });
      expectStatus("no token", noAuth.status, 401, noAuth.body);

      const onOther = await api(`/users/${client.id}/repid`, {
        method: "POST",
        token: outsider.token,
        body: { repIdAddress: outsiderWallet.address }
      });
      expectStatus("linking a RepID onto someone else", onOther.status, 403, onOther.body);

      const own = await api(`/users/${outsider.id}/repid`, {
        method: "POST",
        token: outsider.token,
        body: { repIdAddress: outsiderWallet.address }
      });
      expectStatus("linking a RepID onto your own account", own.status, 204, own.body);

      // A mainnet address must be refused on a Chipnet server.
      const mainnet = await api(`/users/${outsider.id}/repid`, {
        method: "POST",
        token: outsider.token,
        body: { repIdAddress: "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2" }
      });
      check("a mainnet RepID address is refused", mainnet.status >= 400, `got ${mainnet.status}`);
    }

    // --------------------------------------------------------------- arbiters
    section("POST /users/:id/arbiter-profile — only your own profile");
    {
      const noAuth = await api(`/users/${arbiter.id}/arbiter-profile`, {
        method: "POST",
        body: { feeBps: 500 }
      });
      expectStatus("no token", noAuth.status, 401, noAuth.body);

      const onOther = await api(`/users/${arbiter.id}/arbiter-profile`, {
        method: "POST",
        token: outsider.token,
        body: { feeBps: 500 }
      });
      expectStatus("rewriting another user's fee", onOther.status, 403, onOther.body);

      const badFee = await api(`/users/${outsider.id}/arbiter-profile`, {
        method: "POST",
        token: outsider.token,
        body: { feeBps: 99_999 }
      });
      expectStatus("a fee of 99999 bps", badFee.status, 400, badFee.body);
    }

    // ------------------------------------------------- escrow transaction GETs
    section("escrow transaction endpoints — party-scoped, not just authenticated");
    {
      const endpoints: [string, string][] = [
        ["release-transaction", `/escrows/${bilateralId}/release-transaction`],
        ["reclaim-transaction", `/escrows/${bilateralId}/reclaim-transaction`],
        ["arbitrated-spend-transaction", `/escrows/${arbitratedId}/arbitrated-spend-transaction?outcome=release`],
        ["arbitrated-spend/pending", `/escrows/${arbitratedId}/arbitrated-spend/pending`]
      ];
      for (const [label, path] of endpoints) {
        const noAuth = await api(path);
        expectStatus(`${label} with no token`, noAuth.status, 401, noAuth.body);
        const byOutsider = await api(path, { token: outsider.token });
        expectStatus(`${label} as an unrelated user`, byOutsider.status, 403, byOutsider.body);
      }
    }

    // -------------------------------------------------- two-step signing writes
    section("two-step signing endpoints — the three that were fully open");
    {
      const noAuth = await api(`/escrows/${arbitratedId}/arbitrated-spend/first-signature`, {
        method: "POST",
        body: { signedTransactionHex: fakeTxHex, signedBy: outsider.id, outcome: "release" }
      });
      expectStatus("first-signature with no token", noAuth.status, 401, noAuth.body);

      const byOutsider = await api(`/escrows/${arbitratedId}/arbitrated-spend/first-signature`, {
        method: "POST",
        token: outsider.token,
        body: { signedTransactionHex: fakeTxHex, signedBy: outsider.id, outcome: "release" }
      });
      expectStatus("first-signature as an unrelated user", byOutsider.status, 403, byOutsider.body);

      const badHex = await api(`/escrows/${arbitratedId}/arbitrated-spend/first-signature`, {
        method: "POST",
        token: client.token,
        body: { signedTransactionHex: "not hex at all", outcome: "release" }
      });
      expectStatus("first-signature with a non-hex body", badHex.status, 422, badHex.body);

      // Claiming to be a different party than the session must be refused.
      // pending_signature_by is a UUID FK to users(id), so signedBy is a user id.
      const spoofed = await api(`/escrows/${arbitratedId}/arbitrated-spend/first-signature`, {
        method: "POST",
        token: client.token,
        body: { signedTransactionHex: fakeTxHex, signedBy: freelancer.id, outcome: "release" }
      });
      expectStatus("first-signature claiming another wallet as signedBy", spoofed.status, 400, spoofed.body);

      const stored = await api(`/escrows/${arbitratedId}/arbitrated-spend/first-signature`, {
        method: "POST",
        token: client.token,
        body: { signedTransactionHex: fakeTxHex, outcome: "release" }
      });
      expectStatus("first-signature as the client", stored.status, 204, stored.body);
    }

    section("the two escrow modes stay separated");
    {
      const releaseOnArbitrated = await api(`/escrows/${arbitratedId}/release-transaction`, {
        token: client.token
      });
      expectStatus("release-transaction on an arbitrated escrow", releaseOnArbitrated.status, 400, releaseOnArbitrated.body);

      const firstSigOnBilateral = await api(`/escrows/${bilateralId}/arbitrated-spend/first-signature`, {
        method: "POST",
        token: client.token,
        body: { signedTransactionHex: fakeTxHex, outcome: "release" }
      });
      expectStatus("first-signature on a bilateral escrow", firstSigOnBilateral.status, 400, firstSigOnBilateral.body);
    }

    // ------------------------------------------------------- funding authority
    section("funding — the client funds, and only the client");
    {
      const noAuth = await api(`/escrows/${bilateralId}/funding-details`);
      expectStatus("funding-details with no token", noAuth.status, 401, noAuth.body);

      const byFreelancer = await api(`/escrows/${bilateralId}/funding-details`, { token: freelancer.token });
      expectStatus("funding-details as the freelancer", byFreelancer.status, 403, byFreelancer.body);

      const byOutsider = await api(`/escrows/${bilateralId}/funding-details`, { token: outsider.token });
      expectStatus("funding-details as an unrelated user", byOutsider.status, 403, byOutsider.body);

      const details = await api(`/escrows/${bilateralId}/funding-details`, { token: client.token });
      expectStatus("funding-details as the client", details.status, 200, details.body);
      // The amount must come from the escrow record, never from the request.
      check(
        "the amount is the agreed escrow amount, not caller-supplied",
        details.body?.amountSats === 40_000,
        `amountSats=${details.body?.amountSats}`
      );
      check(
        "the payout is the amount minus the covenant's fixed fee",
        details.body?.payoutSats === 39_000,
        `payoutSats=${details.body?.payoutSats}`
      );

      const fundByFreelancer = await api(`/escrows/${bilateralId}/funding`, {
        method: "POST",
        token: freelancer.token,
        body: { signedTransactionHex: fakeTxHex }
      });
      expectStatus("funding as the freelancer", fundByFreelancer.status, 403, fundByFreelancer.body);
    }

    // ------------------------------------------------- settlement state machine
    section("settlement — purpose must match the escrow's state and the caller's role");
    {
      const noAuth = await api(`/escrows/${bilateralId}/broadcast`, {
        method: "POST",
        body: { signedTransactionHex: fakeTxHex, purpose: "funding" }
      });
      expectStatus("broadcast with no token", noAuth.status, 401, noAuth.body);

      const byOutsider = await api(`/escrows/${bilateralId}/broadcast`, {
        method: "POST",
        token: outsider.token,
        body: { signedTransactionHex: fakeTxHex, purpose: "funding" }
      });
      expectStatus("broadcast as an unrelated user", byOutsider.status, 403, byOutsider.body);

      const noPurpose = await api(`/escrows/${bilateralId}/broadcast`, {
        method: "POST",
        token: client.token,
        body: { signedTransactionHex: fakeTxHex }
      });
      expectStatus("broadcast with no purpose", noPurpose.status, 400, noPurpose.body);

      const bogusPurpose = await api(`/escrows/${bilateralId}/broadcast`, {
        method: "POST",
        token: client.token,
        body: { signedTransactionHex: fakeTxHex, purpose: "make-it-rain" }
      });
      expectStatus("broadcast with an invented purpose", bogusPurpose.status, 400, bogusPurpose.body);

      // This escrow is still pending_funding, so a release is premature. The
      // state machine must reject it before any transaction is broadcast.
      const releaseTooEarly = await api(`/escrows/${bilateralId}/broadcast`, {
        method: "POST",
        token: client.token,
        body: { signedTransactionHex: fakeTxHex, purpose: "release" }
      });
      expectStatus("releasing an unfunded escrow", releaseTooEarly.status, 403, releaseTooEarly.body);
      check(
        "the error names the status the step requires",
        String(releaseTooEarly.body?.error ?? "").includes("funded"),
        `error=${releaseTooEarly.body?.error}`
      );

      // A bilateral escrow has no arbitrated spend path.
      const arbitratedPurposeOnBilateral = await api(`/escrows/${bilateralId}/broadcast`, {
        method: "POST",
        token: client.token,
        body: { signedTransactionHex: fakeTxHex, purpose: "arbitrated-release" }
      });
      expectStatus("arbitrated-release on a bilateral escrow", arbitratedPurposeOnBilateral.status, 403, arbitratedPurposeOnBilateral.body);

      // The freelancer may reclaim, but not release — the covenant will only
      // accept the client's signature on that path.
      const releaseByFreelancer = await api(`/escrows/${bilateralId}/broadcast`, {
        method: "POST",
        token: freelancer.token,
        body: { signedTransactionHex: fakeTxHex, purpose: "release" }
      });
      expectStatus("releasing as the freelancer", releaseByFreelancer.status, 403, releaseByFreelancer.body);

      const reclaimByClient = await api(`/escrows/${bilateralId}/broadcast`, {
        method: "POST",
        token: client.token,
        body: { signedTransactionHex: fakeTxHex, purpose: "reclaim" }
      });
      expectStatus("reclaiming as the client", reclaimByClient.status, 403, reclaimByClient.body);
    }

    // ------------------------------------- final-signature requires real proof
    // Everything above exercises routes that reject bad input. This last block
    // exercises the property that matters most: the second signature alone is
    // NOT enough to mark an escrow released.
    section("final-signature cannot settle without a real on-chain transaction");
    {
      // Stand in for an on-chain funding, which this test cannot produce without
      // spending real coins. Written straight to the DB purely as a fixture.
      const fakeFundingTxid = "b".repeat(64);
      await pool.query(
        "UPDATE escrows SET status = 'funded', funding_txid = $2 WHERE id = $1",
        [arbitratedId, fakeFundingTxid]
      );

      // Re-record a first signature so a pending signature exists.
      await api(`/escrows/${arbitratedId}/arbitrated-spend/first-signature`, {
        method: "POST",
        token: client.token,
        body: { signedTransactionHex: fakeTxHex, outcome: "release" }
      });

      const noAuth = await api(`/escrows/${arbitratedId}/arbitrated-spend/final-signature`, {
        method: "POST",
        body: { signedTransactionHex: fakeTxHex }
      });
      expectStatus("final-signature with no token", noAuth.status, 401, noAuth.body);

      const byOutsider = await api(`/escrows/${arbitratedId}/arbitrated-spend/final-signature`, {
        method: "POST",
        token: outsider.token,
        body: { signedTransactionHex: fakeTxHex }
      });
      expectStatus("final-signature as an unrelated user", byOutsider.status, 403, byOutsider.body);

      // The first signer must not be able to complete its own 2-of-3.
      const selfFinalize = await api(`/escrows/${arbitratedId}/arbitrated-spend/final-signature`, {
        method: "POST",
        token: client.token,
        body: { signedTransactionHex: fakeTxHex }
      });
      expectStatus("the first signer finalizing alone", selfFinalize.status, 403, selfFinalize.body);

      const badHex = await api(`/escrows/${arbitratedId}/arbitrated-spend/final-signature`, {
        method: "POST",
        token: freelancer.token,
        body: { signedTransactionHex: "not hex" }
      });
      expectStatus("final-signature with a non-hex body", badHex.status, 422, badHex.body);

      // The legitimate second co-signer now gets past every authz and shape
      // check — and is stopped by chain verification, because the escrow's
      // funding output does not exist. This is the old bug's inverse: a signed
      // request is no longer enough to write `released`.
      const settle = await api(`/escrows/${arbitratedId}/arbitrated-spend/final-signature`, {
        method: "POST",
        token: freelancer.token,
        body: { signedTransactionHex: fakeTxHex }
      });
      check(
        "the legitimate second signer is stopped by on-chain verification",
        settle.status >= 400 && String(settle.body?.error ?? "").includes("no longer holds"),
        `status=${settle.status} error=${settle.body?.error}`
      );

      const after = await api(`/escrows/${arbitratedId}`);
      check(
        "the escrow was NOT marked released",
        after.body?.status === "funded",
        `status=${after.body?.status}`
      );
      check("and no release txid was recorded", !after.body?.releaseTxid, `releaseTxid=${after.body?.releaseTxid}`);

      await pool.end();
    }
  } finally {
    server.kill();
  }

    const summary = skipped
      ? `${passed} passed, ${failed} failed, ${skipped} skipped`
      : `${passed} passed, ${failed} failed`;
    console.log(`\n${summary}`);
    process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
