export type CacheEvictionReason = "capacity" | "expired";

export type CacheEvictionEvent = {
  count: number;
  reason: CacheEvictionReason;
  size: number;
};

type CacheEntry<Value> = {
  expiresAt: number;
  value: Value;
};

type BoundedExpiringCacheOptions = {
  maxEntries: number;
  now?: () => number;
  onEviction?: (event: CacheEvictionEvent) => void;
};

export class BoundedExpiringCache<Key, Value> {
  readonly #entries = new Map<Key, CacheEntry<Value>>();
  readonly #maxEntries: number;
  readonly #now: () => number;
  readonly #onEviction: ((event: CacheEvictionEvent) => void) | undefined;

  constructor({
    maxEntries,
    now = Date.now,
    onEviction,
  }: BoundedExpiringCacheOptions) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0) {
      throw new Error("Cache maxEntries must be a positive integer.");
    }
    this.#maxEntries = maxEntries;
    this.#now = now;
    this.#onEviction = onEviction;
  }

  get size(): number {
    return this.#entries.size;
  }

  get(key: Key): Value | undefined {
    const entry = this.#entries.get(key);
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAt <= this.#now()) {
      this.#entries.delete(key);
      this.#emitEviction("expired", 1);
      return undefined;
    }

    this.#entries.delete(key);
    this.#entries.set(key, entry);
    return entry.value;
  }

  set(key: Key, value: Value, expiresAt: number): void {
    if (!Number.isSafeInteger(expiresAt)) {
      throw new Error("Cache expiresAt must be a safe integer.");
    }
    const now = this.#now();
    this.#purgeExpired(now);
    this.#entries.delete(key);
    if (expiresAt <= now) {
      return;
    }

    this.#entries.set(key, { expiresAt, value });
    let evicted = 0;
    while (this.#entries.size > this.#maxEntries) {
      const oldestKey = this.#entries.keys().next().value as Key | undefined;
      if (oldestKey === undefined) {
        break;
      }
      this.#entries.delete(oldestKey);
      evicted += 1;
    }
    this.#emitEviction("capacity", evicted);
  }

  #purgeExpired(now: number): void {
    let evicted = 0;
    for (const [key, entry] of this.#entries) {
      if (entry.expiresAt <= now) {
        this.#entries.delete(key);
        evicted += 1;
      }
    }
    this.#emitEviction("expired", evicted);
  }

  #emitEviction(reason: CacheEvictionReason, count: number): void {
    if (!count) {
      return;
    }
    this.#onEviction?.({ count, reason, size: this.#entries.size });
  }
}
