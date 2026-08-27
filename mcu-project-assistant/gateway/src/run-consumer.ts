import { connectRabbitMQ } from "./lib/rabbitmq";
import { startOrchestrator } from "./lib/orchestrator";
import { logger } from "@/lib/logger";

async function main() {
  await connectRabbitMQ();
  startOrchestrator();
  logger.info("Consumer running. Press Ctrl+C to exit.");
}

main().catch((err) => logger.error("Consumer exited", { error: err }));
