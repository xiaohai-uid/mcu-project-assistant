import { runMigrations } from "./lib/migrate";
import { connectRabbitMQ } from "./lib/rabbitmq";
import { startOrchestrator } from "./lib/orchestrator";
import { logger } from "./lib/logger";

async function main() {
  await runMigrations();
  await connectRabbitMQ();
  startOrchestrator();
  logger.info("Consumer running. Press Ctrl+C to exit.");
}

main().catch((err) => {
  logger.error("Consumer fatal error", { error: String(err) });
  process.exit(1);
});
