import { test } from "node:test";
import assert from "node:assert/strict";
import {
    scanSubreddit,
    checkAuthorsBlocked,
    buildSubredditUrls,
    matchesKeywords,
    sha256Hex,
} from "../src/lib/subredditScan.js";
import { createBlocklistClient } from "../src/blocklist.js";
import { getStatus } from "../src/lib/postMedia.js";

// Helper: fast sleep replacement for tests
const noopSleep = async () => {};

test("classification of removed, deleted and normal posts", async () => {
    const rawPosts = [
        { id: "p1", author: "alice", title: "Active Normal Post", selftext: "Hello world", created_utc: 1000 },
        { id: "p2", author: "bob", title: "Mod Removed", selftext: "[removed]", created_utc: 950 },
        { id: "p3", author: "charlie", title: "Automod Filtered", selftext: "Original text preserved", removed_by_category: "automod_filtered", created_utc: 900 },
        { id: "p4", author: "dave", title: "Author Deleted Selftext", selftext: "[deleted]", created_utc: 850 },
        { id: "p5", author: "[deleted]", title: "Author Deleted Account", selftext: "Some text", created_utc: 800 },
    ];

    const res = await scanSubreddit({
        subreddit: "technology",
        maxPages: 1,
        fetchPage: async () => ({ items: rawPosts, ok: true }),
        isBlockedAuthor: async () => false,
        getStatus,
        sleep: noopSleep,
    });

    assert.equal(res.scannedCount, 5);
    assert.equal(res.foundCount, 4);
    assert.equal(res.items.length, 4);
    assert.deepEqual(res.items.map((p) => p.id), ["p2", "p3", "p4", "p5"]);
    assert.equal(res.errors.length, 0);
});

test("blocked authors dropped silently with totals unaffected and [deleted] author kept", async () => {
    // Hashes:
    // "blocked_user" -> will be simulated as blocked
    const rawPosts = [
        { id: "p1", author: "good_user", title: "Removed Post 1", selftext: "[removed]", created_utc: 1000 },
        { id: "p2", author: "blocked_user", title: "Removed Post 2", selftext: "[removed]", created_utc: 900 },
        { id: "p3", author: "[deleted]", title: "Deleted User Post", selftext: "[removed]", created_utc: 800 },
    ];

    const res = await scanSubreddit({
        subreddit: "news",
        maxPages: 1,
        fetchPage: async () => ({ items: rawPosts, ok: true }),
        isBlockedAuthor: async (author) => author === "blocked_user",
        getStatus,
        sleep: noopSleep,
    });

    // p2 is by blocked_user:
    // Must be completely omitted from items
    assert.deepEqual(res.items.map((p) => p.id), ["p1", "p3"]);
    // Must be excluded from scannedCount (3 raw - 1 blocked = 2 unblocked scanned)
    assert.equal(res.scannedCount, 2);
    // Must be excluded from foundCount (found 2 unblocked removed posts)
    assert.equal(res.foundCount, 2);
    // Items with author "[deleted]" are kept
    assert.equal(res.items.find((p) => p.id === "p3")?.author, "[deleted]");
});

test("static BLOCKED_HASHES are recognized and dropped silently", async () => {
    // Compute hash for a test blocked user
    const testBlockedName = "test_blocked_account";
    const testHash = await sha256Hex(testBlockedName);

    const rawPosts = [
        { id: "p1", author: testBlockedName, title: "Blocked author post", selftext: "[removed]", created_utc: 1000 },
        { id: "p2", author: "clean_user", title: "Clean author post", selftext: "[removed]", created_utc: 900 },
    ];

    const res = await scanSubreddit({
        subreddit: "AskReddit",
        maxPages: 1,
        fetchPage: async () => ({ items: rawPosts, ok: true }),
        blockedHashes: [testHash],
        dynamicallyBlocked: async () => false,
        getStatus,
        sleep: noopSleep,
    });

    assert.equal(res.scannedCount, 1);
    assert.equal(res.foundCount, 1);
    assert.deepEqual(res.items.map((p) => p.id), ["p2"]);
});

test("the dynamic blocklist unavailable -> fail-safe behavior drops all real authors and keeps [deleted]", async () => {
    // Removal service is failing/unavailable
    const failingBlocklistClient = createBlocklistClient({
        origin: "https://removal.rosint.dev",
        fetcher: async () => {
            throw new Error("503 Service Unavailable");
        },
    });

    const rawPosts = [
        { id: "p1", author: "alice", title: "Alice post", selftext: "[removed]", created_utc: 1000 },
        { id: "p2", author: "bob", title: "Bob post", selftext: "[removed]", created_utc: 950 },
        { id: "p3", author: "[deleted]", title: "Deleted author post", selftext: "[removed]", created_utc: 900 },
    ];

    const res = await scanSubreddit({
        subreddit: "technology",
        maxPages: 1,
        fetchPage: async () => ({ items: rawPosts, ok: true }),
        blockedHashes: ["f".repeat(64)],
        dynamicallyBlocked: failingBlocklistClient,
        getStatus,
        sleep: noopSleep,
    });

    // Because dynamic blocklist is unavailable, it fails closed (marks all named authors blocked).
    // alice and bob are silently dropped.
    // [deleted] author has no identifiable name and is preserved.
    assert.equal(res.items.length, 1);
    assert.equal(res.items[0].id, "p3");
    assert.equal(res.items[0].author, "[deleted]");
    assert.equal(res.scannedCount, 1);
    assert.equal(res.foundCount, 1);
});

test("cursor moves to the oldest timestamp seen on page", async () => {
    const pageCalls = [];
    const page1 = [
        { id: "p1", author: "u1", selftext: "[removed]", created_utc: 5000 },
        { id: "p2", author: "u2", selftext: "[removed]", created_utc: 4500 },
        { id: "p3", author: "u3", selftext: "[removed]", created_utc: 4200 },
    ];
    const page2 = [
        { id: "p4", author: "u4", selftext: "[removed]", created_utc: 4000 },
        { id: "p5", author: "u5", selftext: "[removed]", created_utc: 3800 },
    ];

    const res = await scanSubreddit({
        subreddit: "technology",
        maxPages: 2,
        targetCount: 10,
        fetchPage: async ({ cursor }) => {
            pageCalls.push(cursor);
            return {
                items: pageCalls.length === 1 ? page1 : page2,
                ok: true,
            };
        },
        isBlockedAuthor: async () => false,
        getStatus,
        sleep: noopSleep,
    });

    // Initial page had no cursor (null), second page got 4200 (oldest of page 1)
    assert.deepEqual(pageCalls, [null, 4200]);
    // Result nextCursor is 3800 (oldest of page 2)
    assert.equal(res.nextCursor, 3800);
    assert.equal(res.items.length, 5);
});

test("stops at maxPages", async () => {
    let pagesFetched = 0;
    const res = await scanSubreddit({
        subreddit: "technology",
        maxPages: 3,
        targetCount: 100, // will not be reached
        fetchPage: async ({ cursor }) => {
            pagesFetched++;
            const base = (cursor || 10000) - 100;
            return {
                items: [{ id: `post-${pagesFetched}`, author: "u", selftext: "[removed]", created_utc: base }],
                ok: true,
            };
        },
        isBlockedAuthor: async () => false,
        getStatus,
        sleep: noopSleep,
    });

    assert.equal(pagesFetched, 3);
    assert.equal(res.items.length, 3);
    assert.equal(res.exhausted, false);
});

test("stops immediately when targetCount is reached", async () => {
    let pagesFetched = 0;
    const res = await scanSubreddit({
        subreddit: "technology",
        maxPages: 10,
        targetCount: 3,
        fetchPage: async () => {
            pagesFetched++;
            return {
                items: [
                    { id: `p${pagesFetched}-1`, author: "u", selftext: "[removed]", created_utc: 1000 },
                    { id: `p${pagesFetched}-2`, author: "u", selftext: "[removed]", created_utc: 900 },
                    { id: `p${pagesFetched}-3`, author: "u", selftext: "[removed]", created_utc: 800 },
                ],
                ok: true,
            };
        },
        isBlockedAuthor: async () => false,
        getStatus,
        sleep: noopSleep,
    });

    // Target is 3, first page provided 3 matching items, so it stops after page 1
    assert.equal(pagesFetched, 1);
    assert.equal(res.items.length, 3);
    assert.equal(res.foundCount, 3);
});

test("stops and marks exhausted when archive returns no more items", async () => {
    let pagesFetched = 0;
    const res = await scanSubreddit({
        subreddit: "technology",
        maxPages: 5,
        targetCount: 10,
        fetchPage: async () => {
            pagesFetched++;
            return { items: [], ok: true };
        },
        isBlockedAuthor: async () => false,
        getStatus,
        sleep: noopSleep,
    });

    assert.equal(pagesFetched, 1);
    assert.equal(res.items.length, 0);
    assert.equal(res.exhausted, true);
});

test("a page error keeps earlier results and captures error", async () => {
    let pagesFetched = 0;
    const res = await scanSubreddit({
        subreddit: "technology",
        maxPages: 3,
        targetCount: 10,
        fetchPage: async () => {
            pagesFetched++;
            if (pagesFetched === 1) {
                return {
                    items: [
                        { id: "p1", author: "u1", selftext: "[removed]", created_utc: 5000 },
                        { id: "p2", author: "u2", selftext: "[removed]", created_utc: 4500 },
                    ],
                    ok: true,
                };
            }
            throw new Error("Network timeout on page 2");
        },
        isBlockedAuthor: async () => false,
        getStatus,
        sleep: noopSleep,
    });

    assert.equal(res.items.length, 2);
    assert.equal(res.foundCount, 2);
    assert.equal(res.scannedCount, 2);
    assert.equal(res.nextCursor, 4500);
    assert.equal(res.errors.length, 1);
    assert.match(res.errors[0], /Network timeout on page 2/);
});

test("keyword fallback: client-side filtering correctly keeps matching posts", async () => {
    const rawPosts = [
        { id: "p1", author: "u1", title: "Apple releases new M4 Mac", selftext: "[removed]", created_utc: 1000 },
        { id: "p2", author: "u2", title: "Something completely different", selftext: "[removed]", created_utc: 900 },
        { id: "p3", author: "u3", title: "Discussion about tech", selftext: "Mentions apple in selftext", removed_by_category: "moderator", created_utc: 800 },
    ];

    const res = await scanSubreddit({
        subreddit: "technology",
        filters: { keywords: "Apple" },
        maxPages: 1,
        fetchPage: async () => ({ items: rawPosts, ok: true }),
        isBlockedAuthor: async () => false,
        getStatus,
        sleep: noopSleep,
    });

    assert.equal(res.items.length, 2);
    assert.deepEqual(res.items.map((p) => p.id), ["p1", "p3"]);
});

test("batched check calls dynamic list at most once per page", async () => {
    let dynamicFetches = 0;
    const dynamicClient = createBlocklistClient({
        origin: "https://removal.rosint.dev",
        fetcher: async (url) => {
            if (url.endsWith("/config")) return Response.json({ featuresEnabled: true });
            dynamicFetches++;
            return Response.json({ hashes: [] });
        },
    });

    // 6 posts with 4 distinct real authors (alice, bob, charlie, dave)
    const rawAuthors = [
        "alice",
        "bob",
        "alice",
        "charlie",
        "[deleted]",
        "dave",
        "",
    ];

    const blocked = await checkAuthorsBlocked(rawAuthors, {
        blockedHashes: [],
        dynamicallyBlocked: dynamicClient,
    });

    assert.equal(blocked.size, 0);
    // Even though 4 distinct authors were checked, the dynamic list endpoint was read ONCE
    assert.equal(dynamicFetches, 1);
});

test("buildSubredditUrls constructs valid Arctic Shift and PullPush URLs", () => {
    const urls = buildSubredditUrls({
        subreddit: "r/technology",
        cursor: 1700000000,
        filters: {
            over18: true,
            keywords: "quantum computing",
            dateFrom: 1690000000,
        },
    });

    assert.ok(urls.arctic.includes("subreddit=technology"));
    assert.ok(urls.arctic.includes("limit=100"));
    assert.ok(urls.arctic.includes("over_18=true"));
    assert.ok(urls.arctic.includes("before=1700000000"));
    assert.ok(urls.arctic.includes("after=1690000000"));
    assert.ok(urls.arctic.includes("query=quantum%20computing"));

    assert.ok(urls.pullpush.includes("subreddit=technology"));
    assert.ok(urls.pullpush.includes("q=quantum%20computing"));
});

test("safety guard: refuses to run when no checker supplied", async () => {
    const res = await scanSubreddit({
        subreddit: "technology",
        fetchPage: async () => ({ items: [{ id: "p1", selftext: "[removed]" }], ok: true }),
    });
    assert.equal(res.items.length, 0);
    assert.equal(res.foundCount, 0);
    assert.equal(res.scannedCount, 0);
    assert.ok(res.errors.length > 0);
    assert.match(res.errors[0], /checker required/i);
});

test("safety guard: refuses to run with empty blockedHashes and no dynamic checker", async () => {
    const res = await scanSubreddit({
        subreddit: "technology",
        blockedHashes: [],
        dynamicallyBlocked: null,
        fetchPage: async () => ({ items: [{ id: "p1", selftext: "[removed]" }], ok: true }),
    });
    assert.equal(res.items.length, 0);
    assert.equal(res.foundCount, 0);
    assert.equal(res.scannedCount, 0);
    assert.ok(res.errors.length > 0);
    assert.match(res.errors[0], /checker required/i);
});

test("empty-subreddit guard: scanSubreddit returns error and never calls fetchPage", async () => {
    const invalidSubreddits = ["", "   ", "r/", "technology and science", "sub-with-dashes!"];
    for (const sub of invalidSubreddits) {
        let fetchPageCalled = false;
        const res = await scanSubreddit({
            subreddit: sub,
            fetchPage: async () => {
                fetchPageCalled = true;
                return { items: [], ok: true };
            },
            isBlockedAuthor: async () => false,
            sleep: noopSleep,
        });

        assert.equal(fetchPageCalled, false, `fetchPage should never be called for '${sub}'`);
        assert.equal(res.items.length, 0);
        assert.equal(res.foundCount, 0);
        assert.equal(res.scannedCount, 0);
        assert.equal(res.exhausted, true);
        assert.ok(res.errors.length > 0);
        assert.match(res.errors[0], /invalid subreddit/i);
    }
});

test("blocklist request count: unreachable removal service causes at most 1 dynamic request per page for 100 distinct authors and fails closed", async () => {
    let requestCount = 0;
    const failingBlocklistClient = createBlocklistClient({
        origin: "https://removal.rosint.dev",
        fetcher: async () => {
            requestCount++;
            throw new Error("503 Service Unavailable");
        },
    });

    const posts = Array.from({ length: 100 }, (_, i) => ({
        id: `post_${i}`,
        author: `author_${i}`,
        title: `Post ${i}`,
        selftext: "[removed]",
        created_utc: 10000 - i,
    }));

    const res = await scanSubreddit({
        subreddit: "technology",
        maxPages: 1,
        fetchPage: async () => ({ items: posts, ok: true }),
        blockedHashes: ["f".repeat(64)],
        dynamicallyBlocked: failingBlocklistClient,
        getStatus,
        sleep: noopSleep,
    });

    // Exactly 1 request to /api/config was initiated
    assert.equal(requestCount, 1);
    // All real authors failed closed and were dropped
    assert.equal(res.items.length, 0);
    assert.equal(res.foundCount, 0);
    assert.equal(res.scannedCount, 0);
});

test("checker precedence: blockedHashes + dynamicallyBlocked takes precedence over isBlockedAuthor when both are supplied", async () => {
    let isBlockedAuthorCalled = false;
    let dynamicFetches = 0;

    const dummyDynamicClient = createBlocklistClient({
        origin: "https://removal.rosint.dev",
        fetcher: async (url) => {
            if (url.endsWith("/config")) return Response.json({ featuresEnabled: true });
            dynamicFetches++;
            return Response.json({ hashes: [] });
        },
    });

    const posts = Array.from({ length: 50 }, (_, i) => ({
        id: `p_${i}`,
        author: `user_${i}`,
        selftext: "[removed]",
        created_utc: 5000 - i,
    }));

    const res = await scanSubreddit({
        subreddit: "technology",
        maxPages: 1,
        targetCount: 50,
        fetchPage: async () => ({ items: posts, ok: true }),
        isBlockedAuthor: async () => {
            isBlockedAuthorCalled = true;
            return false;
        },
        blockedHashes: ["0".repeat(64)],
        dynamicallyBlocked: dummyDynamicClient,
        getStatus,
        sleep: noopSleep,
    });

    assert.equal(isBlockedAuthorCalled, false, "isBlockedAuthor should not be called when blockedHashes + dynamicallyBlocked is supplied");
    assert.equal(dynamicFetches, 1, "dynamic blocklist fetched exactly once");
    assert.equal(res.items.length, 50);
});

