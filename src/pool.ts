/**
 * Bounded-concurrency task runner.
 *
 * Runs at most `concurrency` tasks in parallel while preserving input order in
 * the returned results. A task that rejects does not stop the batch; its slot
 * is filled by the next queued task and the rejection is surfaced per-item.
 */

export type SettledResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: unknown };

/**
 * Execute `tasks` with bounded concurrency.
 *
 * @param items        the input items (order is preserved in the output)
 * @param concurrency  maximum number of simultaneously running tasks (>= 1)
 * @param worker       async function mapping an item to a result
 * @returns per-item settled results, in the original input order
 */
export async function runWithConcurrency<TItem, TResult>(
  items: TItem[],
  concurrency: number,
  worker: (item: TItem, index: number) => Promise<TResult>
): Promise<Array<SettledResult<TResult>>> {
  const results: Array<SettledResult<TResult>> = new Array(items.length);
  const limit = Math.max(1, Math.floor(concurrency));
  let nextIndex = 0;

  async function runner(): Promise<void> {
    while (true) {
      const current = nextIndex++;
      if (current >= items.length) return;
      try {
        const value = await worker(items[current], current);
        results[current] = { ok: true, value };
      } catch (error) {
        // One failed task must not stop the batch.
        results[current] = { ok: false, error };
      }
    }
  }

  const runners = Array.from({ length: Math.min(limit, items.length) }, () => runner());
  await Promise.all(runners);
  return results;
}
