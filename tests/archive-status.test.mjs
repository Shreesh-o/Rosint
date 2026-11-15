import { test } from "node:test";
import assert from "node:assert/strict";
import {
    classifyError,
    resolveArchiveStatus,
    safeArchiveFetch,
    combineArchiveResponses,
    ERROR_CODES,
} from "../src/lib/archiveStatus.js";
import { createProfileCache, MemoryStorageAdapter, loadProfileWithCache } from "../src/lib/profileCache.js";

// ─── Status Classifier Tests ──────────────────────────────────────────────────

test("classifyError: handles timeouts (AbortError, TimeoutError, regex match)", () => {
    assert.equal(classifyError({ error: new Error("Request timed out") }), ERROR_CODES.TIMEOUT);
    const abortErr = new Error("The operation was aborted");
    abortErr.name = "AbortError";
    assert.equal(classifyError({ error: abortErr }), ERROR_CODES.TIMEOUT);
    const timeoutErr = new Error("Connection timeout");
    timeoutErr.name = "TimeoutError";
    assert.equal(classifyError({ error: timeoutErr }), ERROR_CODES.TIMEOUT);
});

test("classifyError: handles 429 rate limit", () => {
    assert.equal(classifyError({ status: 429 }), ERROR_CODES.RATE_LIMITED);
    assert.equal(classifyError({ response: { status: 429 } }), ERROR_CODES.RATE_LIMITED);
});

test("classifyError: handles 5xx server errors", () => {
    assert.equal(classifyError({ status: 500 }), ERROR_CODES.SERVER_ERROR);
    assert.equal(classifyError({ status: 502 }), ERROR_CODES.SERVER_ERROR);
    assert.equal(classifyError({ status: 503 }), ERROR_CODES.SERVER_ERROR);
    assert.equal(classifyError({ status: 520 }), ERROR_CODES.SERVER_ERROR);
    assert.equal(classifyError({ response: { status: 504 } }), ERROR_CODES.SERVER_ERROR);
});

test("classifyError: handles bad responses (bad JSON, 4xx non-429)", () => {
    assert.equal(
        classifyError({ error: new SyntaxError("Unexpected token < in JSON at position 0") }),
        ERROR_CODES.BAD_RESPONSE
    );
    assert.equal(classifyError({ status: 404 }), ERROR_CODES.BAD_RESPONSE);
    assert.equal(classifyError({ status: 422 }), ERROR_CODES.BAD_RESPONSE);
});

test("resolveArchiveStatus: both ok", () => {
    const arctic = { ok: true, data: [{ id: "1" }], error: null };
    const pullpush = { ok: true, data: [{ id: "2" }], error: null };
    const res = resolveArchiveStatus(arctic, pullpush);
    assert.equal(res.state, "ok");
    assert.equal(res.partial, false);
    assert.equal(res.down, false);
    assert.equal(res.rateLimited, false);
});

test("resolveArchiveStatus: success with zero items is NOT an outage", () => {
    const arctic = { ok: true, data: [], error: null };
    const pullpush = { ok: true, data: [], error: null };
    const res = resolveArchiveStatus(arctic, pullpush);
    assert.equal(res.state, "ok");
    assert.equal(res.partial, false);
    assert.equal(res.down, false);
});

test("resolveArchiveStatus: one failed is partial, not down", () => {
    const arctic = { ok: true, data: [{ id: "1" }], error: null };
    const pullpush = { ok: false, data: [], error: ERROR_CODES.SERVER_ERROR };
    const res = resolveArchiveStatus(arctic, pullpush);
    assert.equal(res.state, "partial");
    assert.equal(res.partial, true);
    assert.equal(res.down, false);
    assert.equal(res.failedArchive, "PullPush");

    const res2 = resolveArchiveStatus(
        { ok: false, data: [], error: ERROR_CODES.TIMEOUT },
        { ok: true, data: [], error: null }
    );
    assert.equal(res2.state, "partial");
    assert.equal(res2.partial, true);
    assert.equal(res2.down, false);
    assert.equal(res2.failedArchive, "Arctic Shift");
});

test("resolveArchiveStatus: both failed is down", () => {
    const arctic = { ok: false, data: [], error: ERROR_CODES.SERVER_ERROR };
    const pullpush = { ok: false, data: [], error: ERROR_CODES.TIMEOUT };
    const res = resolveArchiveStatus(arctic, pullpush);
    assert.equal(res.state, "down");
    assert.equal(res.partial, false);
    assert.equal(res.down, true);
    assert.equal(res.rateLimited, false);
});

test("resolveArchiveStatus: detects rate limiting when archive reports rate_limited", () => {
    const arctic = { ok: false, data: [], error: ERROR_CODES.RATE_LIMITED };
    const pullpush = { ok: false, data: [], error: ERROR_CODES.SERVER_ERROR };
    const res = resolveArchiveStatus(arctic, pullpush);
    assert.equal(res.state, "down");
    assert.equal(res.down, true);
    assert.equal(res.rateLimited, true);
});

// ─── Cache Outage Invariant Tests ─────────────────────────────────────────────

test("loadProfileWithCache: never writes an outage result into cache and preserves cached data", async () => {
    const storage = new MemoryStorageAdapter();
    const testCache = createProfileCache({ storage });

    const username = "testuser";
    const initialSavedAt = 1000000;
    // Pre-populate cache with valid data
    await testCache.set(username, {
        posts: { items: [{ id: "post1", title: "Cached Post", created_utc: 500 }], sources: ["Arctic Shift"] },
        comments: { items: [{ id: "comm1", body: "Cached Comment", created_utc: 500 }], sources: ["Arctic Shift"] },
        savedAt: initialSavedAt,
    });

    let hydratedPosts = null;
    let hydratedComments = null;
    let cacheInfoResult = null;
    let refreshingState = null;

    // Simulate archive outage on revalidation
    const mockPosts = {
        items: [],
        sources: [],
        archiveState: "down",
        pageStack: [],
        hydrate: (data) => { hydratedPosts = data; },
        reset: async () => [],
    };
    const mockComments = {
        items: [],
        sources: [],
        archiveState: "down",
        pageStack: [],
        hydrate: (data) => { hydratedComments = data; },
        reset: async () => [],
    };

    await loadProfileWithCache({
        username,
        filters: {},
        forceRefresh: false,
        hasFilters: false,
        posts: mockPosts,
        comments: mockComments,
        isBlockedUser: async () => false,
        runDecoySearch: async () => {},
        setSearchBlocked: () => {},
        setInitialLoading: () => {},
        setCacheInfo: (info) => { cacheInfoResult = info; },
        setRefreshing: (val) => { refreshingState = val; },
        cache: testCache,
    });

    // Wait for background revalidation promise to settle
    await new Promise((r) => setTimeout(r, 10));

    // 1. Cached items were hydrated instantly
    assert.ok(hydratedPosts);
    assert.equal(hydratedPosts.items[0].id, "post1");
    assert.ok(hydratedComments);

    // 2. Refresh finished
    assert.equal(refreshingState, false);

    // 3. Banner updated to notify unreachable refresh without dropping cache
    assert.ok(cacheInfoResult);
    assert.equal(cacheInfoResult.isCached, true);
    assert.match(cacheInfoResult.error || "", /unreachable|couldn't refresh/i);

    // 4. Cache in storage was NOT overwritten by the empty outage result
    const stored = await testCache.get(username);
    assert.ok(stored);
    assert.equal(stored.posts.items.length, 1);
    assert.equal(stored.posts.items[0].id, "post1");
    assert.equal(stored.savedAt, initialSavedAt);
});

// ─── Fetch-Level Tests with Injected Fake Fetchers ───────────────────────────

test("safeArchiveFetch: classification on 200 with empty data is ok without error", async () => {
    const fakeFetcher = async () => new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
    });

    const res = await safeArchiveFetch("https://archive.example/api", { fetcher: fakeFetcher, retries: 0 });
    assert.equal(res.ok, true);
    assert.deepEqual(res.data, []);
    assert.equal(res.error, null);
    assert.equal(res.status, 200);
});

test("safeArchiveFetch: classification on 500 server error", async () => {
    const fakeFetcher = async () => new Response("Internal Server Error", { status: 500 });
    const res = await safeArchiveFetch("https://archive.example/api", { fetcher: fakeFetcher, retries: 0 });
    assert.equal(res.ok, false);
    assert.deepEqual(res.data, []);
    assert.equal(res.error, ERROR_CODES.SERVER_ERROR);
    assert.equal(res.status, 500);
});

test("safeArchiveFetch: classification on 429 rate limit", async () => {
    const fakeFetcher = async () => new Response("Too Many Requests", { status: 429 });
    const res = await safeArchiveFetch("https://archive.example/api", { fetcher: fakeFetcher, retries: 0 });
    assert.equal(res.ok, false);
    assert.equal(res.error, ERROR_CODES.RATE_LIMITED);
    assert.equal(res.status, 429);
});

test("safeArchiveFetch: classification on bad JSON / HTML error page", async () => {
    const fakeFetcher = async () => new Response("<html>Cloudflare Error</html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
    });
    const res = await safeArchiveFetch("https://archive.example/api", { fetcher: fakeFetcher, retries: 0 });
    assert.equal(res.ok, false);
    assert.equal(res.error, ERROR_CODES.BAD_RESPONSE);
});

test("combineArchiveResponses: zero items with ok=true is NOT an outage", () => {
    const arctic = { ok: true, data: [], error: null };
    const pullpush = { ok: true, data: [], error: null };
    const combined = combineArchiveResponses(arctic, pullpush);
    assert.equal(combined.down, false);
    assert.equal(combined.partial, false);
    assert.equal(combined.archiveStatus.state, "ok");
    assert.deepEqual(combined.items, []);
});

test("combineArchiveResponses: one failed is partial, preserving items from healthy archive", () => {
    const arctic = { ok: true, data: [{ id: "p1", title: "Post 1" }], error: null };
    const pullpush = { ok: false, data: [], error: ERROR_CODES.SERVER_ERROR };
    const combined = combineArchiveResponses(arctic, pullpush);
    assert.equal(combined.down, false);
    assert.equal(combined.partial, true);
    assert.equal(combined.archiveStatus.state, "partial");
    assert.equal(combined.items.length, 1);
    assert.deepEqual(combined.sources, ["Arctic Shift"]);
});

test("combineArchiveResponses: both failed is down", () => {
    const arctic = { ok: false, data: [], error: ERROR_CODES.TIMEOUT };
    const pullpush = { ok: false, data: [], error: ERROR_CODES.SERVER_ERROR };
    const combined = combineArchiveResponses(arctic, pullpush);
    assert.equal(combined.down, true);
    assert.equal(combined.partial, false);
    assert.equal(combined.archiveStatus.state, "down");
    assert.deepEqual(combined.items, []);
});

