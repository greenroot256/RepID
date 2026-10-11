import type { FastifyInstance } from "fastify";
import fs from "fs/promises";
import path from "path";

export async function reputationRoutes(app: FastifyInstance) {
  // GET /reputation/:address – returns a deterministic mock score for the demo.
  // The implementation now validates the address and handles missing/invalid state files gracefully.
  app.get<{ Params: { address: string } }>("/reputation/:address", async (request, reply) => {
    const { address } = request.params;

    // Basic guard – if the client sends an empty address we return a 400 Bad Request.
    if (!address || address.trim() === "") {
      reply.code(400).send({ error: "RepID address is required" });
      return;
    }

    let score = 0;
    let totalRatings = 0;

    try {
      const storePath = path.resolve(process.cwd(), "data/repid-state.json");
      const data = await fs.readFile(storePath, "utf8");
      const state = JSON.parse(data);
      // NOTE: The real aggregation would walk `state.facts` and compute a weighted score.
      // For the demo we generate a deterministic pseudo‑random score based on the address.
      const seed = address.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
      score = 3 + (seed % 3); // 3‑5 range
      totalRatings = 5 + (seed % 10);
    } catch (err) {
      // If the state file does not exist (e.g., before the indexer has run) we simply keep score 0.
      // Any other parsing error also falls back to the default values.
      app.log.warn(`RepID state unavailable or failed to read: ${err}`);
      score = 0;
      totalRatings = 0;
    }

    reply.send({
      address,
      score: score.toFixed(1),
      totalRatings,
      verified: totalRatings > 0,
    });
  });
}
