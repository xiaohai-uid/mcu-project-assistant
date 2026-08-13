export interface ReconnectHydrationRetry {
  request: (projectId: string) => void;
  cancel: () => void;
}

export interface ReconnectHydrationRetryOptions {
  delaysMs?: readonly number[];
}

const DEFAULT_DELAYS_MS = [100, 250, 500, 1_000, 2_000] as const;

type RetryState = {
  generation: number;
  projectId: string;
  attempt: number;
  timer: ReturnType<typeof setTimeout> | null;
  controller: AbortController;
};

export function createReconnectHydrationRetry(
  hydrate: (projectId: string, signal: AbortSignal) => Promise<boolean>,
  options: ReconnectHydrationRetryOptions = {},
): ReconnectHydrationRetry {
  const delaysMs = options.delaysMs?.length ? options.delaysMs : DEFAULT_DELAYS_MS;
  let generation = 0;
  let state: RetryState | null = null;

  const isCurrent = (candidate: RetryState): boolean => state === candidate && candidate.generation === generation && !candidate.controller.signal.aborted;

  const cancel = (): void => {
    generation += 1;
    const current = state;
    state = null;
    if (!current) return;
    if (current.timer !== null) clearTimeout(current.timer);
    current.controller.abort();
  };

  const run = async (current: RetryState): Promise<void> => {
    if (!isCurrent(current)) return;
    current.timer = null;
    let hydrated = false;
    try {
      hydrated = await hydrate(current.projectId, current.controller.signal);
    } catch {
      hydrated = false;
    }
    if (!isCurrent(current)) return;
    if (hydrated) {
      state = null;
      return;
    }
    const delay = delaysMs[Math.min(current.attempt, delaysMs.length - 1)] ?? DEFAULT_DELAYS_MS.at(-1)!;
    current.attempt += 1;
    current.timer = setTimeout(() => {
      void run(current);
    }, delay);
  };

  return {
    request(projectId: string): void {
      if (state?.projectId === projectId && !state.controller.signal.aborted) return;
      cancel();
      const current: RetryState = {
        generation: ++generation,
        projectId,
        attempt: 0,
        timer: null,
        controller: new AbortController(),
      };
      state = current;
      void run(current);
    },
    cancel,
  };
}
