import { SerialPort } from "serialport";

export interface SerialTransport {
  readonly isOpen: boolean;
  on(event: "open", listener: () => void): this;
  on(event: "data", listener: (chunk: Buffer) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  on(event: "close", listener: (error?: Error) => void): this;
  once(event: "open", listener: () => void): this;
  once(event: "data", listener: (chunk: Buffer) => void): this;
  once(event: "error", listener: (error: Error) => void): this;
  once(event: "close", listener: (error?: Error) => void): this;
  removeListener(event: "open", listener: () => void): this;
  removeListener(event: "data", listener: (chunk: Buffer) => void): this;
  removeListener(event: "error", listener: (error: Error) => void): this;
  removeListener(event: "close", listener: (error?: Error) => void): this;
  write(data: Buffer | string, callback?: (error?: Error | null) => void): boolean;
  close(callback?: (error?: Error | null) => void): void;
  open(callback?: (error?: Error | null) => void): void;
}

export type SerialTransportFactory = (input: { path: string; baudRate: number }) => SerialTransport;

/** Production OS transport. Tests inject a controlled transport fixture. */
export const createSerialTransport: SerialTransportFactory = ({ path, baudRate }) =>
  new SerialPort({ path, baudRate, autoOpen: false });
