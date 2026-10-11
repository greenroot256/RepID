import type { FastifyInstance } from "fastify";
import { ElectrumNetworkProvider } from "cashscript";
import { db } from "../db/client.js";
import { network } from "../config.js";

/**
 * Liveness plus real dependency checks. Each dependency is probed on every call
 * rather than cached, so this doubles as the readiness signal the end-to-end
 * test uses to confirm the API is genuinely wired to PostgreSQL and to a
 * Chipnet Electrum server before any funds move.
 */
export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async (_req, reply) => {
    const database = await probe(async () => {
      await db.query("SELECT 1");
      return "ok";
    });

    const electrum = await probe(async () => {
      // getBlockHeight needs a websocket round-trip, so it is a real check
      // that the configured server is reachable and serving the right chain.
      const provider = new ElectrumNetworkProvider(network);
      const height = await provider.getBlockHeight();
      return `ok (height ${height})`;
    });

    const healthy = database.ok && electrum.ok;
    return reply.code(healthy ? 200 : 503).send({
      status: healthy ? "ok" : "degraded",
      service: "cash-freelancers-api",
      network,
      dependencies: { database, electrum }
    });
  });
}

interface ProbeResult {
  ok: boolean;
  detail: string;
}

async function probe(fn: () => Promise<string>): Promise<ProbeResult> {
  try {
    return { ok: true, detail: await fn() };
  } catch (err) {
    // The message can contain the connection string, which embeds a password,
    // so only the error name is reported outward.
    return { ok: false, detail: (err as Error).name };
  }
}
