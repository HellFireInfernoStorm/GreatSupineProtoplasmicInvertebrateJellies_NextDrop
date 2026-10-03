export interface FeedHint {
  head: string;
  resetEpoch: number;
}

export interface FeedHub {
  /** The current hint, read now. */
  current(): Promise<FeedHint>;
  /** Called with each new hint. Returns an unsubscribe function. */
  subscribe(listener: (hint: FeedHint) => void): () => void;
  close(): void;
}

/**
 * One poller per process, running only while a stream is open, so every SSE connection shares a single
 * `head`/`resetEpoch` read per interval. Any writer and any demo reset is seen without a LISTEN connection (ADR 0027).
 */
export function createFeedHub(
  read: () => Promise<FeedHint>,
  intervalMs: number,
  onError: (error: unknown) => void,
): FeedHub {
  const listeners = new Set<(hint: FeedHint) => void>();
  let last: FeedHint | undefined;
  let timer: NodeJS.Timeout | undefined;
  let polling = false;

  async function poll() {
    if (polling) return;
    polling = true;
    try {
      const hint = await read();
      if (!last || hint.head !== last.head || hint.resetEpoch !== last.resetEpoch) {
        last = hint;
        for (const listener of listeners) listener(hint);
      }
    } catch (error) {
      onError(error);
    } finally {
      polling = false;
    }
  }

  return {
    current: read,
    subscribe(listener) {
      listeners.add(listener);
      timer ??= setInterval(() => void poll(), intervalMs);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && timer) {
          clearInterval(timer);
          timer = undefined;
          last = undefined;
        }
      };
    },
    close() {
      listeners.clear();
      if (timer) clearInterval(timer);
      timer = undefined;
    },
  };
}
