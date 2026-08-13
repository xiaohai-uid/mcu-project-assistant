// adapters/device/resource-lock.ts — process-local exclusive resource ownership.
// The current server is a single process, so a tiny synchronous lease registry
// is sufficient. Callers must release the returned lease in every terminal path.

export interface ResourceLease {
  readonly key: string;
  readonly ownerId: string;
  release(): void;
}

export interface ResourceLock {
  tryAcquire(key: string, ownerId: string): ResourceLease | null;
}

export function createResourceLock(): ResourceLock {
  const owners = new Map<string, ResourceLease>();

  return {
    tryAcquire(key: string, ownerId: string): ResourceLease | null {
      if (owners.has(key)) return null;
      let released = false;
      const lease: ResourceLease = {
        key,
        ownerId,
        release(): void {
          if (released) return;
          released = true;
          if (owners.get(key) === lease) owners.delete(key);
        },
      };
      owners.set(key, lease);
      return lease;
    },
  };
}
