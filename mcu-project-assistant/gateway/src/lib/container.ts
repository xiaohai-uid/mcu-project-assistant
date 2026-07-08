import type { StageHandler } from "./stage-handler";

class Container {
  private handlers = new Map<string, StageHandler>();

  register(queue: string, handler: StageHandler): void {
    this.handlers.set(queue, handler);
  }

  getAll(): [string, StageHandler][] {
    return Array.from(this.handlers.entries());
  }

  clear(): void {
    this.handlers.clear();
  }
}

export const container = new Container();
