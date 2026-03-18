/**
 * Minimal key-value store interface for session state and consume-once tracking.
 * Default implementation is in-memory; swap for Redis/Cloudflare KV/etc. in production.
 */
export interface KeyValueStore {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}

/** In-memory store suitable for development and single-process servers. */
export function createMemoryStore(): KeyValueStore {
  const data = new Map<string, unknown>();
  return {
    async get<T>(key: string): Promise<T | undefined> {
      return data.get(key) as T | undefined;
    },
    async put<T>(key: string, value: T): Promise<void> {
      data.set(key, value);
    },
  };
}
