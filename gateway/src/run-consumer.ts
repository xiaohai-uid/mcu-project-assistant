import { connectRabbitMQ } from "./lib/rabbitmq";
import { startOrchestrator } from "./lib/orchestrator";

async function main() {
  await connectRabbitMQ();
  startOrchestrator();
  console.log("Consumer running. Press Ctrl+C to exit.");
}

main().catch(console.error);
