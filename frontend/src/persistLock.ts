/** Run a save, then repeat if newer edits landed while the first request was in flight. */

export type PersistLock = { current: Promise<unknown> | null };

export async function runLatest<T>(
  lock: PersistLock,
  task: () => Promise<T>,
  again: () => boolean,
  max = 3,
): Promise<T> {
  let result: T | undefined;
  for (let attempt = 0; attempt < max; attempt += 1) {
    while (lock.current) {
      await lock.current.catch(() => undefined);
    }
    const run = task();
    lock.current = run;
    try {
      result = await run;
    } finally {
      if (lock.current === run) lock.current = null;
    }
    if (!again()) return result as T;
  }
  return result as T;
}
