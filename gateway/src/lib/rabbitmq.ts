import amqplib from "amqplib";
import { QUEUE_NAMES } from "./pipeline";
import { logger } from "./logger";

export const QUEUES = QUEUE_NAMES;

let connection: any = null;
let channel: amqplib.Channel | null = null;

export async function connectRabbitMQ(url?: string) {
  const connectionUrl = url || process.env.RABBITMQ_URL || "amqp://localhost";
  connection = await amqplib.connect(connectionUrl);
  channel = await connection.createChannel();

  if (!channel) throw new Error("Failed to create channel");
  for (const queue of Object.values(QUEUES)) {
    await channel.assertQueue(queue, { durable: true });
  }

  logger.info("RabbitMQ connected");
  return channel;
}

export function getChannel() {
  if (!channel) throw new Error("RabbitMQ not connected");
  return channel;
}

export async function publishToQueue(queue: string, message: object) {
  let ch = channel;
  if (!ch) {
    await connectRabbitMQ();
    ch = channel;
  }
  if (!ch) throw new Error("Failed to connect RabbitMQ");
  ch.sendToQueue(queue, Buffer.from(JSON.stringify(message)), {
    persistent: true,
  });
}
