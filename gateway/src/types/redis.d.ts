declare module "redis" {
  interface RedisClientOptions {
    url?: string;
    [key: string]: unknown;
  }

  interface RedisClient {
    on(event: string, listener: (...args: any[]) => void): void;
    connect(): Promise<void>;
    get(key: string): Promise<string | null>;
    set(key: string, value: string, options?: { PX?: number }): Promise<string>;
    disconnect(): Promise<void>;
  }

  export function createClient(options?: RedisClientOptions): RedisClient;
}
