import { normalizeUsername } from '../normalizeUsername.js';

export const DEFAULT_MAX_CACHE_BYTES = 1.5 * 1024 * 1024 * 1024; // 1.5 GB
export const DB_NAME = 'rosint_cache';
export const DB_VERSION = 1;
export const STORE_NAME = 'profiles';

/**
 * Normalizes username for cache keys.
 */
export function normalizeCacheKey(rawUsername) {
    if (!rawUsername || typeof rawUsername !== 'string') return '';
    return normalizeUsername(rawUsername).toLowerCase();
}

/**
 * Merges two arrays of posts or comments by item.id without duplicating.
 * Fresh items take precedence, and results are sorted by created_utc descending.
 */
export function mergeItemsById(existingItems = [], freshItems = []) {
    const seen = new Set();
    const merged = [];

    // Fresh items first
    for (const item of freshItems || []) {
        if (item && item.id && !seen.has(item.id)) {
            seen.add(item.id);
            merged.push(item);
        }
    }

    // Existing cached items
    for (const item of existingItems || []) {
        if (item && item.id && !seen.has(item.id)) {
            seen.add(item.id);
            merged.push(item);
        }
    }

    merged.sort((a, b) => (b.created_utc || 0) - (a.created_utc || 0));
    return merged;
}

/**
 * Estimates byte size of an object when serialized to JSON.
 */
export function estimateSize(obj) {
    try {
        const json = JSON.stringify(obj);
        if (typeof Blob !== 'undefined') {
            return new Blob([json]).size;
        }
        if (typeof TextEncoder !== 'undefined') {
            return new TextEncoder().encode(json).length;
        }
        return json.length * 2;
    } catch {
        return 1024;
    }
}

/**
 * Formats a relative time string (e.g. "updated 3h ago", "updated just now").
 */
export function formatRelativeTime(timestampMs, nowMs = Date.now()) {
    if (!timestampMs || typeof timestampMs !== 'number') return 'updated recently';
    const diffSec = Math.max(0, Math.floor((nowMs - timestampMs) / 1000));
    if (diffSec < 60) return 'updated just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `updated ${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `updated ${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `updated ${diffDays}d ago`;
}

/**
 * In-memory storage adapter for testing and environments without IndexedDB.
 */
export class MemoryStorageAdapter {
    constructor() {
        this.store = new Map();
    }
    async get(key) {
        return this.store.get(key) || null;
    }
    async set(key, value) {
        this.store.set(key, value);
    }
    async delete(key) {
        this.store.delete(key);
    }
    async clear() {
        this.store.clear();
    }
    async getAll() {
        return Array.from(this.store.values());
    }
}

/**
 * IndexedDB storage adapter.
 */
export class IndexedDBStorageAdapter {
    constructor({ dbName = DB_NAME, storeName = STORE_NAME } = {}) {
        this.dbName = dbName;
        this.storeName = storeName;
        this._dbPromise = null;
    }

    _getDB() {
        if (typeof indexedDB === 'undefined') return Promise.resolve(null);
        if (this._dbPromise) return this._dbPromise;

        this._dbPromise = new Promise((resolve) => {
            try {
                const req = indexedDB.open(this.dbName, DB_VERSION);
                req.onupgradeneeded = (e) => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains(this.storeName)) {
                        db.createObjectStore(this.storeName, { keyPath: 'username' });
                    }
                };
                req.onsuccess = (e) => resolve(e.target.result);
                req.onerror = () => resolve(null);
            } catch {
                resolve(null);
            }
        });
        return this._dbPromise;
    }

    async get(key) {
        const db = await this._getDB();
        if (!db) return null;
        return new Promise((resolve) => {
            try {
                const tx = db.transaction(this.storeName, 'readonly');
                const store = tx.objectStore(this.storeName);
                const req = store.get(key);
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = () => resolve(null);
            } catch {
                resolve(null);
            }
        });
    }

    async set(key, value) {
        const db = await this._getDB();
        if (!db) return;
        return new Promise((resolve) => {
            try {
                const tx = db.transaction(this.storeName, 'readwrite');
                const store = tx.objectStore(this.storeName);
                const req = store.put({ ...value, username: key });
                req.onsuccess = () => resolve(true);
                req.onerror = () => resolve(false);
            } catch {
                resolve(false);
            }
        });
    }

    async delete(key) {
        const db = await this._getDB();
        if (!db) return;
        return new Promise((resolve) => {
            try {
                const tx = db.transaction(this.storeName, 'readwrite');
                const store = tx.objectStore(this.storeName);
                const req = store.delete(key);
                req.onsuccess = () => resolve(true);
                req.onerror = () => resolve(false);
            } catch {
                resolve(false);
            }
        });
    }

    async clear() {
        const db = await this._getDB();
        if (!db) return;
        return new Promise((resolve) => {
            try {
                const tx = db.transaction(this.storeName, 'readwrite');
                const store = tx.objectStore(this.storeName);
                const req = store.clear();
                req.onsuccess = () => resolve(true);
                req.onerror = () => resolve(false);
            } catch {
                resolve(false);
            }
        });
    }

    async getAll() {
        const db = await this._getDB();
        if (!db) return [];
        return new Promise((resolve) => {
            try {
                const tx = db.transaction(this.storeName, 'readonly');
                const store = tx.objectStore(this.storeName);
                const req = store.getAll();
                req.onsuccess = () => resolve(req.result || []);
                req.onerror = () => resolve([]);
            } catch {
                resolve([]);
            }
        });
    }
}

/**
 * Pure profile cache manager supporting LRU eviction and quota enforcement.
 */
export function createProfileCache({
    storage = (typeof indexedDB !== 'undefined' ? new IndexedDBStorageAdapter() : new MemoryStorageAdapter()),
    maxSizeBytes = DEFAULT_MAX_CACHE_BYTES,
    estimateQuota = (typeof navigator !== 'undefined' && navigator.storage?.estimate)
        ? () => navigator.storage.estimate()
        : null,
    now = () => Date.now(),
} = {}) {
    async function get(rawUsername) {
        const key = normalizeCacheKey(rawUsername);
        if (!key) return null;
        try {
            const entry = await storage.get(key);
            if (!entry) return null;
            // Update accessedAt on hit (for LRU)
            const updated = { ...entry, accessedAt: now() };
            storage.set(key, updated).catch(() => {});
            return updated;
        } catch {
            return null;
        }
    }

    async function set(rawUsername, data) {
        const key = normalizeCacheKey(rawUsername);
        if (!key || !data) return;

        try {
            const nowMs = now();
            const entry = {
                username: key,
                posts: data.posts || { items: [], sources: [], pageStack: [] },
                comments: data.comments || { items: [], sources: [], pageStack: [] },
                savedAt: data.savedAt || nowMs,
                accessedAt: nowMs,
            };
            const itemSize = estimateSize(entry);
            entry.size = itemSize;

            // Check browser quota
            let effectiveMaxBytes = maxSizeBytes;
            if (typeof estimateQuota === 'function') {
                try {
                    const quotaEst = await estimateQuota();
                    if (quotaEst && typeof quotaEst.quota === 'number') {
                        // Use at most 80% of remaining room or maxSizeBytes
                        const available = Math.max(0, quotaEst.quota - (quotaEst.usage || 0));
                        effectiveMaxBytes = Math.min(maxSizeBytes, Math.max(itemSize, available * 0.8));
                    }
                } catch {
                    // Ignore quota estimation failure
                }
            }

            // Evict LRU entries if needed
            const all = await storage.getAll();
            const otherEntries = all.filter((e) => e.username !== key);
            let currentTotalSize = otherEntries.reduce((sum, e) => sum + (e.size || estimateSize(e)), 0);

            if (currentTotalSize + itemSize > effectiveMaxBytes) {
                // Sort least-recently-used first
                otherEntries.sort((a, b) => (a.accessedAt || 0) - (b.accessedAt || 0));
                for (const oldEntry of otherEntries) {
                    if (currentTotalSize + itemSize <= effectiveMaxBytes) break;
                    await storage.delete(oldEntry.username);
                    currentTotalSize -= (oldEntry.size || estimateSize(oldEntry));
                }
            }

            await storage.set(key, entry);
        } catch {
            // Silently fail if storage throws
        }
    }

    async function remove(rawUsername) {
        const key = normalizeCacheKey(rawUsername);
        if (!key) return;
        try {
            await storage.delete(key);
        } catch {
            // Silently fail
        }
    }

    async function clear() {
        try {
            await storage.clear();
        } catch {
            // Silently fail
        }
    }

    async function getTotalSize() {
        try {
            const all = await storage.getAll();
            return all.reduce((sum, e) => sum + (e.size || estimateSize(e)), 0);
        } catch {
            return 0;
        }
    }

    return {
        get,
        set,
        remove,
        clear,
        getTotalSize,
    };
}

// Default singleton instance using IndexedDB in browser, MemoryStorageAdapter in tests
export const defaultCache = createProfileCache();

let debounceTimer = null;
export function saveCachedProfileDebounced(username, data, delayMs = 500) {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        saveCachedProfile(username, data);
        debounceTimer = null;
    }, delayMs);
}

export const getCachedProfile = (u) => defaultCache.get(u);
export const saveCachedProfile = (u, d) => defaultCache.set(u, d);
export const deleteCachedProfile = (u) => defaultCache.remove(u);
export const clearProfileCache = () => defaultCache.clear();

/**
 * Coordinates stale-while-revalidate profile loading:
 * 1. Evaluates isBlockedUser(username) BEFORE any cache read.
 *    If blocked: deletes cached profile, runs decoy search, returns.
 * 2. On cache hit (and not forceRefresh, and no custom filters):
 *    Instantly hydrates posts and comments from cache, sets initialLoading(false),
 *    and revalidates in the background merging by item.id.
 * 3. On cache miss or forceRefresh:
 *    Fetches fresh from archives and saves merged results to cache (debounced).
 */
export async function loadProfileWithCache({
    username,
    filters = {},
    forceRefresh = false,
    hasFilters = false,
    posts,
    comments,
    isBlockedUser,
    runDecoySearch,
    setSearchBlocked,
    setInitialLoading,
    setCacheInfo,
    setRefreshing,
}) {
    setInitialLoading(true);

    // CRITICAL: Blocklist check MUST run BEFORE any cache read
    if (await isBlockedUser(username)) {
        await deleteCachedProfile(username);
        await runDecoySearch();
        return;
    }

    setSearchBlocked(false);

    // Try cache hit
    if (!forceRefresh && !hasFilters) {
        try {
            const cached = await getCachedProfile(username);
            if (cached && cached.posts && cached.comments && (cached.posts.items.length > 0 || cached.comments.items.length > 0)) {
                // Instantly render cached data
                posts.hydrate(cached.posts);
                comments.hydrate(cached.comments);
                setCacheInfo({ isCached: true, savedAt: cached.savedAt });
                setInitialLoading(false);
                setRefreshing(true);

                // Background revalidation
                Promise.all([
                    posts.reset(username, filters, { mergeWith: cached.posts.items }),
                    comments.reset(username, filters, { mergeWith: cached.comments.items }),
                ]).then(([freshPosts, freshComments]) => {
                    setRefreshing(false);
                    if (freshPosts && freshComments) {
                        const nowMs = Date.now();
                        saveCachedProfileDebounced(username, {
                            posts: { items: freshPosts, sources: posts.sources, pageStack: posts.pageStack },
                            comments: { items: freshComments, sources: comments.sources, pageStack: comments.pageStack },
                            savedAt: nowMs,
                        });
                        setCacheInfo({ isCached: true, savedAt: nowMs });
                    }
                }).catch(() => {
                    setRefreshing(false);
                });
                return;
            }
        } catch {
            // Silently fall back to normal fetch
        }
    }

    // Cache miss or forceRefresh
    setCacheInfo(null);
    setRefreshing(false);
    setInitialLoading(true);

    try {
        const [freshPosts, freshComments] = await Promise.all([
            posts.reset(username, filters),
            comments.reset(username, filters),
        ]);
        if (!hasFilters && freshPosts && freshComments) {
            saveCachedProfileDebounced(username, {
                posts: { items: freshPosts, sources: posts.sources, pageStack: posts.pageStack },
                comments: { items: freshComments, sources: comments.sources, pageStack: comments.pageStack },
                savedAt: Date.now(),
            });
        }
    } finally {
        setInitialLoading(false);
    }
}

