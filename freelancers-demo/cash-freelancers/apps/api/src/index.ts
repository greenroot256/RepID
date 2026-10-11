import Fastify from "fastify";
import { describeConfig, port } from "./config.js";
import { assertDatabaseReachable } from "./db/client.js";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { userRoutes } from "./routes/users.js";
import { jobRoutes } from "./routes/jobs.js";
import { escrowRoutes } from "./routes/escrows.js";
import { proposalRoutes } from "./routes/proposals.js";
import { disputeRoutes } from "./routes/disputes.js";
import { ratingRoutes } from "./routes/ratings.js";
import { arbiterRoutes } from "./routes/arbiters.js";
import { runIndexer } from "./worker/repid-indexer.js";
import { reputationRoutes } from "./routes/reputation.js";

const app = Fastify({ logger: true });

app.register(healthRoutes);
app.register(authRoutes);
app.register(userRoutes);
app.register(jobRoutes);
app.register(escrowRoutes);
app.register(proposalRoutes);
app.register(disputeRoutes);
app.register(ratingRoutes);
app.register(arbiterRoutes);
app.register(reputationRoutes);

async function start() {
  // Fail loudly before binding the port, so a wrong DATABASE_URL is reported
  // as a startup error rather than as a 500 from an unrelated route later.
  await assertDatabaseReachable();
  app.log.info("Database connection verified.");

  await app.listen({ port, host: "0.0.0.0" });
  app.log.info(describeConfig());

  // Start RepID Indexer loop (every 30 seconds)
  setInterval(() => {
    runIndexer().catch((err) => app.log.error("Indexer error: " + err));
  }, 30000);
  // Run once on startup
  runIndexer().catch((err) => app.log.error("Indexer error: " + err));
}

start().catch((err) => {
  app.log.error(err);
  process.exit(1);
});
