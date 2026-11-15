import { normalizeUsername } from "../normalizeUsername.js";
import { dynamicallyBlocked as defaultDynamicallyBlocked } from "../blocklist.js";
import { fetchWithBackoff } from "../postLookup.js";
import { getStatus as defaultGetStatus } from "./postMedia.js";

// ─── Archive API Constants ───────────────────────────────────────────────────

export const ARCTIC = "https://arctic-shift.photon-reddit.com";
export const PULLPUSH = "https://api.pullpush.io";
export const LIMIT = 100;
export const INTER_PAGE_DELAY_MS = 250;

// Default sleep helper
export const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ─── Helpers ──────────────────────────────────────────────────────────────────

export async function sha256Hex(text) {
    if (!text || typeof text !== "string") return null;
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function matchesKeywords(item, keywords) {
    if (!keywords || typeof keywords !== "string" || !keywords.trim()) return true;
    const lower = keywords.trim().toLowerCase();
    const titleMatch = Boolean(item?.title && item.title.toLowerCase().includes(lower));
    const selftextMatch = Boolean(item?.selftext && item.selftext.toLowerCase().includes(lower));
    return titleMatch || selftextMatch;
}

// ─── Batch Author Check ───────────────────────────────────────────────────────

/**
 * Checks a list of authors against static hashes and dynamic blocklist.
 * Batched per page: dynamic blocklist is fetched at most once per page.
 * Returns a Set of normalized lowercased authors that are blocked.
 */
export async function checkAuthorsBlocked(authors, {
    blockedHashes = [],
    dynamicallyBlocked: checkDynamic = defaultDynamicallyBlocked,
} = {}) {
    if (!Array.isArray(authors) || authors.length === 0) return new Set();

    // Collect distinct real authors (skip "[deleted]", empty, null)
    const distinct = [...new Set(
        authors
            .map((a) => (typeof a === "string" ? normalizeUsername(a).toLowerCase() : ""))
            .filter((a) => a && a !== "[deleted]")
    )];

    if (distinct.length === 0) return new Set();

    // Hash distinct authors in parallel
    const authorHashes = await Promise.all(
        distinct.map(async (norm) => ({
            norm,
            hash: await sha256Hex(norm),
        }))
    );

    const blockedSet = new Set();
    const needDynamicCheck = [];

    for (const { norm, hash } of authorHashes) {
        if (!hash) continue;
        if (blockedHashes.includes(hash)) {
            blockedSet.add(norm);
        } else {
            needDynamicCheck.push({ norm, hash });
        }
    }

    if (needDynamicCheck.length > 0 && typeof checkDynamic === "function") {
        try {
            // Concurrent checks share the dynamic client's internal promise/cache,
            // resulting in at most 1 network request per batch/reuse window.
            const dynamicResults = await Promise.all(
                needDynamicCheck.map(async ({ norm, hash }) => {
                    try {
                        const blocked = await checkDynamic(hash);
                        return { norm, blocked: Boolean(blocked) };
                    } catch {
                        // Fail-closed: if individual check throws, treat as blocked
                        return { norm, blocked: true };
                    }
                })
            );
            for (const { norm, blocked } of dynamicResults) {
                if (blocked) blockedSet.add(norm);
            }
        } catch {
            // Fail-closed: if the entire dynamic call fails, mark all remaining as blocked
            for (const { norm } of needDynamicCheck) {
                blockedSet.add(norm);
            }
        }
    }

    return blockedSet;
}

// ─── Archive Page Fetching ────────────────────────────────────────────────────

export async function safeFetch(url, { retry = true, onRetry, fetcher } = {}) {
    const res = await fetchWithBackoff(url, {
        init: { headers: { Accept: "application/json" } },
        retries: retry ? undefined : 0,
        fetcher,
        onRetry,
    });
    if (!res) return { data: [], ok: false, status: 0 };
    try {
        const json = await res.json();
        return { data: Array.isArray(json?.data) ? json.data : [], ok: true, status: res.status };
    } catch {
        return { data: [], ok: false, status: res.status };
    }
}

export function buildSubredditUrls({ subreddit, cursor, filters = {} }) {
    const cleanSub = subreddit.replace(/^r\//i, "").trim();
    const base = [
        `limit=${LIMIT}`,
        `sort=desc`,
        `subreddit=${encodeURIComponent(cleanSub)}`,
    ];

    if (filters.over18 != null) {
        base.push(`over_18=${filters.over18}`);
    }

    if (cursor) {
        base.push(`before=${cursor}`);
    } else if (filters.dateTo) {
        base.push(`before=${filters.dateTo}`);
    }

    if (filters.dateFrom) {
        base.push(`after=${filters.dateFrom}`);
    }

    const qs = base.join("&");

    let arcticQs = qs;
    let pullpushQs = qs;
    if (filters.keywords) {
        const kw = encodeURIComponent(filters.keywords.trim());
        arcticQs += `&query=${kw}`;
        pullpushQs += `&q=${kw}`;
    }

    return {
        arctic: `${ARCTIC}/api/posts/search?${arcticQs}`,
        pullpush: `${PULLPUSH}/reddit/search/submission/?test&${pullpushQs}`,
        arcticWithoutKw: `${ARCTIC}/api/posts/search?${qs}`,
        pullpushWithoutKw: `${PULLPUSH}/reddit/search/submission/?test&${qs}`,
    };
}

export async function defaultFetchPage({ subreddit, cursor, filters = {}, fetcher, onRetry } = {}) {
    const urls = buildSubredditUrls({ subreddit, cursor, filters });

    let [arcticRes, pullpushRes] = await Promise.all([
        safeFetch(urls.arctic, { fetcher, onRetry }),
        safeFetch(urls.pullpush, { fetcher, onRetry }),
    ]);

    let keywordFallbackUsed = false;
    // If Arctic Shift failed with keywords (e.g. 422 Unprocessable / timeout on large subs),
    // fall back to fetching Arctic Shift without keywords so client-side filtering can rescue it.
    if (filters.keywords && !arcticRes.ok) {
        const fallbackRes = await safeFetch(urls.arcticWithoutKw, { fetcher, onRetry });
        if (fallbackRes.ok) {
            arcticRes = fallbackRes;
            keywordFallbackUsed = true;
        }
    }

    const seen = new Set();
    const merged = [];
    for (const item of [...arcticRes.data, ...pullpushRes.data]) {
        if (item && item.id && !seen.has(item.id)) {
            seen.add(item.id);
            merged.push(item);
        }
    }

    merged.sort((a, b) => (b.created_utc || 0) - (a.created_utc || 0));

    const ok = arcticRes.ok || pullpushRes.ok;
    return {
        items: merged,
        ok,
        keywordFallbackUsed,
    };
}

// ─── Subreddit Scanner ────────────────────────────────────────────────────────

/**
 * Scans a subreddit for deleted/removed posts across multiple pages.
 * Never accesses or modifies IndexedDB profile cache.
 */
export async function scanSubreddit({
    subreddit,
    filters = {},
    cursor = null,
    maxPages = 5,
    targetCount = 25,
    fetchPage = defaultFetchPage,
    isBlockedAuthor,
    getStatus: customGetStatus = defaultGetStatus,
    sleep = defaultSleep,
    blockedHashes,
    dynamicallyBlocked: customDynamicallyBlocked,
} = {}) {
    // ─── Safety Guard ─────────────────────────────────────────────────────────
    // scanSubreddit must refuse to run unless a working author-block checker
    // is supplied: either isBlockedAuthor, or both a non-empty blockedHashes
    // array and dynamicallyBlocked. There must be no permissive default.
    const hasAuthorChecker = typeof isBlockedAuthor === "function" || (
        Array.isArray(blockedHashes) && blockedHashes.length > 0 && typeof customDynamicallyBlocked === "function"
    );

    if (!hasAuthorChecker) {
        return {
            items: [],
            nextCursor: null,
            scannedCount: 0,
            foundCount: 0,
            exhausted: true,
            errors: ["Working author-block checker required: provide either isBlockedAuthor or both a non-empty blockedHashes array and dynamicallyBlocked"],
        };
    }

    const cleanSubreddit = typeof subreddit === "string" ? subreddit.trim().replace(/^r\//i, "").trim() : "";
    if (!cleanSubreddit || !/^[A-Za-z0-9_]+$/.test(cleanSubreddit)) {
        return {
            items: [],
            nextCursor: null,
            scannedCount: 0,
            foundCount: 0,
            exhausted: true,
            errors: ["Invalid subreddit name. Subreddit names must contain only letters, numbers, and underscores."],
        };
    }
    const items = [];
    const errors = [];
    let scannedCount = 0;
    let nextCursor = cursor;
    let exhausted = false;

    for (let page = 0; page < maxPages; page++) {
        let pageRes;
        try {
            pageRes = await fetchPage({
                subreddit: cleanSubreddit,
                cursor: nextCursor,
                filters,
            });
        } catch (err) {
            errors.push(err.message || String(err));
            break;
        }

        const rawItems = Array.isArray(pageRes) ? pageRes : (pageRes?.items || []);
        const isOk = Array.isArray(pageRes) ? true : Boolean(pageRes?.ok);

        if (!isOk) {
            if (pageRes?.error) {
                errors.push(pageRes.error);
            } else if (pageRes?.errors && Array.isArray(pageRes.errors)) {
                errors.push(...pageRes.errors);
            } else {
                errors.push("Failed to fetch archive page");
            }
            break;
        }

        if (rawItems.length === 0) {
            exhausted = true;
            break;
        }

        // Establish nextCursor from oldest timestamp seen on raw page
        const timestamps = rawItems
            .map((p) => p?.created_utc)
            .filter((t) => typeof t === "number" && !Number.isNaN(t));

        let oldestUtc = null;
        if (timestamps.length > 0) {
            oldestUtc = Math.min(...timestamps);
            nextCursor = oldestUtc;
        }

        // ── Batch Author Blocklist Check ──
        let blockedAuthorSet = new Set();
        if (Array.isArray(blockedHashes) && blockedHashes.length > 0 && typeof customDynamicallyBlocked === "function") {
            // When both are supplied, checkAuthorsBlocked takes precedence because it
            // checks static hashes in memory first and batches all dynamic checks
            // into a single microtick, guaranteeing at most 1 network request per page.
            const rawAuthors = rawItems.map((p) => p?.author);
            blockedAuthorSet = await checkAuthorsBlocked(rawAuthors, {
                blockedHashes,
                dynamicallyBlocked: customDynamicallyBlocked,
            });
        } else if (typeof isBlockedAuthor === "function") {
            const distinct = [...new Set(
                rawItems
                    .map((p) => (typeof p?.author === "string" ? normalizeUsername(p.author).toLowerCase() : ""))
                    .filter((a) => a && a !== "[deleted]")
            )];
            await Promise.all(
                distinct.map(async (author) => {
                    try {
                        const blocked = await isBlockedAuthor(author);
                        if (blocked) blockedAuthorSet.add(author);
                    } catch {
                        // Fail-closed
                        blockedAuthorSet.add(author);
                    }
                })
            );
        }

        // ── Privacy Invariant: Silently Drop Blocked Authors ──
        // Blocked authors are completely dropped before counting or collecting.
        // Author "[deleted]" is kept (no identifiable username).
        const unblockedItems = rawItems.filter((p) => {
            if (!p || typeof p !== "object") return false;
            if (!p.author || p.author === "[deleted]") return true;
            const norm = normalizeUsername(p.author).toLowerCase();
            return !blockedAuthorSet.has(norm);
        });

        // scannedCount reflects strictly unblocked posts examined
        scannedCount += unblockedItems.length;

        // ── Filter Matching Items ──
        for (const post of unblockedItems) {
            // Date filters
            if (filters.dateFrom && typeof post.created_utc === "number" && post.created_utc < filters.dateFrom) {
                continue;
            }
            if (filters.dateTo && typeof post.created_utc === "number" && post.created_utc > filters.dateTo) {
                continue;
            }

            // NSFW filter
            if (filters.over18 != null && post.over_18 !== filters.over18) {
                continue;
            }

            // Keyword filter (client-side fallback & verification)
            if (filters.keywords && !matchesKeywords(post, filters.keywords)) {
                continue;
            }

            // Classification: only removed or deleted posts
            const status = customGetStatus(post, "posts");
            if (status.removed || status.deleted) {
                items.push(post);
                if (items.length >= targetCount) {
                    break;
                }
            }
        }

        // Stop if target reached
        if (items.length >= targetCount) {
            break;
        }

        // Check if dateFrom boundary was passed
        if (filters.dateFrom && oldestUtc !== null && oldestUtc <= filters.dateFrom) {
            exhausted = true;
            break;
        }

        // Delay between pages
        if (page < maxPages - 1) {
            await sleep(INTER_PAGE_DELAY_MS);
        }
    }

    return {
        items,
        nextCursor,
        scannedCount,
        foundCount: items.length,
        exhausted,
        errors,
    };
}
