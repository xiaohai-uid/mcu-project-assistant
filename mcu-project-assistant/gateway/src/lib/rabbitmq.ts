import amqplib from "amqplib";

let connection: any = null;
let channel: amqplib.Channel | null = null;

export const QUEUES = {
  REQUIREMENT_INPUT: "requirement.input",
  REQUIREMENT_OUTPUT: "requirement.output",
  RECOMMENDATION_INPUT: "recommendation.input",
  RECOMMENDATION_OUTPUT: "recommendation.output",
  WEBSERACH_INPUT: "websearch.input",
  WEBSERACH_OUTPUT: "websearch.output",
  CODEGEN_INPUT: "codegen.input",
  CODEGEN_OUTPUT: "codegen.output",
  SCHEMATIC_INPUT: "schematic.input",
  SCHEMATIC_OUTPUT: "schematic.output",
} as const;

export async function connectRabbitMQ(url?: string) {
  const connectionUrl = url || process.env.RABBITMQ_URL || "amqp://localhost";
  connection = await amqplib.connect(connectionUrl);
  channel = await connection.createChannel();

  if (!channel) throw new Error("Failed to create channel");
  for (const queue of Object.values(QUEUES)) {
    await channel.assertQueue(queue, { durable: true });
  }

  console.log("RabbitMQ connected");
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
