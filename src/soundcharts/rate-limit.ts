/**
 * Conservative internal limiter for outbound Soundcharts calls: bounded
 * concurrency + a per-minute request budget, well under the API's technical
 * limit. Also records usage counters for the API Usage page.
 */

export const usageMetrics = {
  requests: 0,
  failures: 0,
  planRestricted: 0, // 403
  rateLimited: 0, // 429
  totalDurationMs: 0,
  byStatus: {} as Record<string, number>,
};

export function recordRequest(status: number | null, durationMs: number): void {
  usageMetrics.requests++;
  usageMetrics.totalDurationMs += durationMs;
  const key = status === null ? "network_error" : String(status);
  usageMetrics.byStatus[key] = (usageMetrics.byStatus[key] ?? 0) + 1;
  if (status === null || status >= 400) usageMetrics.failures++;
  if (status === 403) usageMetrics.planRestricted++;
  if (status === 429) usageMetrics.rateLimited++;
}

export function averageResponseMs(): number {
  return usageMetrics.requests > 0 ? Math.round(usageMetrics.totalDurationMs / usageMetrics.requests) : 0;
}

class Limiter {
  private active = 0;
  private queue: Array<() => void> = [];
  private windowStart = Date.now();
  private windowCount = 0;

  constructor(private concurrency: number, private maxPerMinute: number) {}

  private slotFree(): boolean {
    const now = Date.now();
    if (now - this.windowStart >= 60000) { this.windowStart = now; this.windowCount = 0; }
    return this.active < this.concurrency && this.windowCount < this.maxPerMinute;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.slotFree()) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active++;
    this.windowCount++;
    try {
      return await fn();
    } finally {
      this.active--;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

let limiter: Limiter | null = null;
export function getLimiter(concurrency: number, maxPerMinute: number): Limiter {
  if (!limiter) limiter = new Limiter(concurrency, maxPerMinute);
  return limiter;
}
