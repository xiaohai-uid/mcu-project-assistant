export interface ShutdownState {
  isDraining(): boolean;
  begin(): boolean;
  complete(): void;
}

export interface ShutdownCoordinatorDeps {
  state: ShutdownState;
  closeSseStreams: () => void;
  stopAccepting: () => Promise<void>;
  /** Request runtime abort before waiting for the normal drain. */
  stopTasks: () => Promise<void>;
  shutdownDevice: () => Promise<void>;
  forceClose: () => void;
  releaseOwnership: () => void;
  timeoutMs: number;
  onTimeout?: () => void;
}

export interface ShutdownCoordinator {
  beginShutdown(): Promise<void>;
}

export function createShutdownState(): ShutdownState {
  let draining = false;
  let stopped = false;
  return {
    isDraining: () => draining,
    begin: () => {
      if (draining || stopped) return false;
      draining = true;
      return true;
    },
    complete: () => {
      stopped = true;
      draining = true;
    },
  };
}

/** Owns the single, idempotent shutdown lifecycle. */
export function createShutdownCoordinator(deps: ShutdownCoordinatorDeps): ShutdownCoordinator {
  let shutdownPromise: Promise<void> | null = null;

  return {
    beginShutdown(): Promise<void> {
      if (shutdownPromise) return shutdownPromise;
      deps.state.begin();
      shutdownPromise = (async () => {
        let timedOut = false;
        const drain = (async () => {
          const serverClose = deps.stopAccepting();
          deps.closeSseStreams();
          await deps.stopTasks();
          await deps.shutdownDevice();
          await serverClose;
        })();
        void drain.catch(() => undefined);
        let timeout: NodeJS.Timeout | undefined;
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error("shutdown timeout")), deps.timeoutMs);
        });
        try {
          await Promise.race([drain, timeoutPromise]);
        } catch {
          timedOut = true;
          deps.forceClose();
        } finally {
          if (timeout) clearTimeout(timeout);
        }
        if (timedOut) {
          // A forced termination must not release ownership. The dead owner
          // is intentionally left stale so the next process can reclaim it
          // through the production ownership protocol.
          deps.state.complete();
          deps.onTimeout?.();
        } else {
          deps.releaseOwnership();
          deps.state.complete();
        }
      })();
      return shutdownPromise;
    },
  };
}
