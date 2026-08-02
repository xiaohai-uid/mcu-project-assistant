import amqp from "amqplib";

const QUEUE_DESIGN_RUN = "design.run";

let channel: amqp.Channel | null = null;

async function getChannel(): Promise<amqp.Channel> {
  if (channel) return channel;

  const url = process.env.RABBITMQ_URL || "amqp://mcu_service:mcu_mq_secret@localhost:5672/";
  const connection = await amqp.connect(url);
  channel = await connection.createChannel();

  // Declare queue (idempotent)
  await channel.assertQueue(QUEUE_DESIGN_RUN, {
    durable: true,
    deadLetterExchange: "",
    deadLetterRoutingKey: "design.run.retry.5s",
  });

  return channel;
}

/**
 * Publish a run job to RabbitMQ.
 * Message body is ONLY { run_id } — no business payload.
 */
export async function publishRunJob(runId: string): Promise<void> {
  const ch = await getChannel();
  const message = Buffer.from(JSON.stringify({ run_id: runId }));

  ch.publish("", QUEUE_DESIGN_RUN, message, {
    persistent: true,
    contentType: "application/json",
  });
}
