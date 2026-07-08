import { getChannel } from "./rabbitmq";
import { container } from "./container";
import "./handler-index";

export function startOrchestrator() {
  const ch = getChannel();
  for (const [queue, handler] of container.getAll()) {
    ch.consume(queue, (msg: any) => handler.handle(msg), { noAck: false });
  }
  console.log("Orchestrator started — consuming all output queues");
}
