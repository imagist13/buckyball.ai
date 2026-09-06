'use strict';
/**
 * In-memory Next.js incremental-cache handler.
 *
 * WHY: packaged CodePilot runs the Next standalone server with its cwd inside
 * the read-only install dir — on Windows that's
 * `C:\Program Files\CodePilot\resources\standalone`. Next's default
 * FileSystemCache mkdir's `.next/cache` there on the first ISR/fetch cache
 * write and dies with:
 *     EPERM: operation not permitted, mkdir '...\resources\standalone\.next\cache'
 *
 * A desktop app's per-session server gains nothing from a persistent on-disk
 * data cache, so we keep the incremental cache entirely in memory — nothing is
 * written under the install dir, so the read-only path is never touched.
 * (next/image is unused, so there's no separate `.next/cache/images` writer to
 * handle here.)
 *
 * Implements the Next 16 `CacheHandler` shape (get / set / revalidateTag /
 * resetRequestCache). Bounded with a small FIFO cap so a long-running session
 * can't grow it without limit. CommonJS (package.json has no "type":"module")
 * so the standalone server can require() it.
 *
 * Wired via `cacheHandler` + `cacheMaxMemorySize: 0` in next.config.ts.
 */

const MAX_ENTRIES = 1000;

class InMemoryCacheHandler {
  constructor() {
    // Share one store across the process even if Next instantiates the handler
    // more than once (it can construct per cache-kind).
    if (!globalThis.__codepilotNextCache) {
      globalThis.__codepilotNextCache = { store: new Map(), tags: new Map() };
    }
    this._mem = globalThis.__codepilotNextCache;
  }

  async get(cacheKey) {
    return this._mem.store.get(cacheKey) || null;
  }

  async set(cacheKey, data, ctx) {
    // A null payload means "drop this entry".
    if (data === null) {
      this._mem.store.delete(cacheKey);
      return;
    }
    // FIFO cap: evict the oldest entry when full and this is a new key.
    if (this._mem.store.size >= MAX_ENTRIES && !this._mem.store.has(cacheKey)) {
      const oldest = this._mem.store.keys().next().value;
      if (oldest !== undefined) this._mem.store.delete(oldest);
    }
    this._mem.store.set(cacheKey, { value: data, lastModified: Date.now() });
    // Track tag → keys so revalidateTag can purge by tag.
    const tags = (ctx && ctx.tags) || [];
    for (const tag of tags) {
      let keys = this._mem.tags.get(tag);
      if (!keys) {
        keys = new Set();
        this._mem.tags.set(tag, keys);
      }
      keys.add(cacheKey);
    }
  }

  async revalidateTag(tags) {
    const list = Array.isArray(tags) ? tags : [tags];
    for (const tag of list) {
      const keys = this._mem.tags.get(tag);
      if (!keys) continue;
      for (const key of keys) this._mem.store.delete(key);
      this._mem.tags.delete(tag);
    }
  }

  resetRequestCache() {
    // No per-request dedup layer to reset.
  }
}

module.exports = InMemoryCacheHandler;
