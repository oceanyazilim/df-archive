/**
 * Optional short-term TTL cache for resolved lookups.
 *
 * The cache key is `identifierType + ":" + normalizedTrackIdentifier`.
 * The cached value NEVER contains authentication tokens — only the resolved
 * distributor outcome. Entries expire after a configurable TTL so stale
 * ownership information is not retained indefinitely.
 */

import { MatchStatus } from "./types";

export type CachedLookup = {
  licensorUuid: string | null;
  distributor: string | null;
  matchStatus: MatchStatus;
};

type Entry = { value: CachedLookup; expiresAt: number };

export class LookupCache {
  private readonly store = new Map<string, Entry>();
  constructor(private readonly ttlMs: number, private readonly now: () => number = Date.now) {}

  static key(identifierType: string, normalizedIdentifier: string): string {
    return `${identifierType}:${normalizedIdentifier}`;
  }

  get(key: string): CachedLookup | undefined {
    if (this.ttlMs <= 0) return undefined;
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: CachedLookup): void {
    if (this.ttlMs <= 0) return;
    this.store.set(key, { value, expiresAt: this.now() + this.ttlMs });
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}
