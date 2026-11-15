import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    normalizeCacheKey,
    mergeItemsById,
    estimateSize,
    formatRelativeTime,
    createProfileCache,
    MemoryStorageAdapter,
    loadProfileWithCache,
} from '../src/lib/profileCache.js';

test('normalizeCacheKey normalizes username, strips prefixes and URLs, lowercases', () => {
    assert.equal(normalizeCacheKey('spez'), 'spez');
    assert.equal(normalizeCacheKey('u/Spez'), 'spez');
    assert.equal(normalizeCacheKey('@GallowBoob'), 'gallowboob');
    assert.equal(normalizeCacheKey('https://reddit.com/user/kn0thing/'), 'kn0thing');
    assert.equal(normalizeCacheKey(''), '');
    assert.equal(normalizeCacheKey(null), '');
});

test('mergeItemsById merges fresh and cached items without duplicates and sorts by created_utc', () => {
    const cachedItems = [
        { id: 'item_1', created_utc: 100, title: 'Old 1' },
        { id: 'item_2', created_utc: 200, title: 'Old 2' },
        { id: 'item_3', created_utc: 300, title: 'Old 3' },
    ];

    const freshItems = [
        { id: 'item_4', created_utc: 400, title: 'New 4' },
        { id: 'item_3', created_utc: 300, title: 'Fresh 3 Updated' }, // same id as cached
    ];

    const merged = mergeItemsById(cachedItems, freshItems);
    assert.equal(merged.length, 4);

    // Sorted descending by created_utc
    assert.equal(merged[0].id, 'item_4');
    assert.equal(merged[1].id, 'item_3');
    assert.equal(merged[1].title, 'Fresh 3 Updated'); // fresh takes precedence
    assert.equal(merged[2].id, 'item_2');
    assert.equal(merged[3].id, 'item_1');

    // Handles empty/null gracefully
    assert.deepEqual(mergeItemsById([], []), []);
    assert.deepEqual(mergeItemsById(null, null), []);
    assert.deepEqual(mergeItemsById(cachedItems, []), cachedItems.slice().sort((a, b) => b.created_utc - a.created_utc));
});

test('estimateSize returns accurate byte size estimation', () => {
    const sample = { id: 123, text: 'hello world' };
    const size = estimateSize(sample);
    assert.equal(typeof size, 'number');
    assert.ok(size > 20);

    // Empty object
    const emptySize = estimateSize({});
    assert.ok(emptySize > 0 && emptySize < size);
});

test('formatRelativeTime formats relative durations accurately', () => {
    const now = 1700000000000;
    assert.equal(formatRelativeTime(now - 10 * 1000, now), 'updated just now');
    assert.equal(formatRelativeTime(now - 65 * 1000, now), 'updated 1m ago');
    assert.equal(formatRelativeTime(now - 5 * 60 * 1000, now), 'updated 5m ago');
    assert.equal(formatRelativeTime(now - 3 * 3600 * 1000, now), 'updated 3h ago');
    assert.equal(formatRelativeTime(now - 2 * 86400 * 1000, now), 'updated 2d ago');
    assert.equal(formatRelativeTime(null, now), 'updated recently');
});

test('createProfileCache performs get, set, remove, clear, and size accounting', async () => {
    const storage = new MemoryStorageAdapter();
    const cache = createProfileCache({ storage });

    // Cache miss
    assert.equal(await cache.get('alice'), null);

    // Set and get
    const aliceData = {
        posts: { items: [{ id: 'p1', created_utc: 100 }] },
        comments: { items: [{ id: 'c1', created_utc: 200 }] },
        savedAt: 1700000000000,
    };
    await cache.set('u/Alice', aliceData);

    const retrieved = await cache.get('alice');
    assert.ok(retrieved);
    assert.equal(retrieved.username, 'alice');
    assert.equal(retrieved.posts.items.length, 1);
    assert.equal(retrieved.comments.items.length, 1);

    // Size accounting
    const totalSize = await cache.getTotalSize();
    assert.ok(totalSize > 0);

    // Remove
    await cache.remove('alice');
    assert.equal(await cache.get('alice'), null);
    assert.equal(await cache.getTotalSize(), 0);

    // Clear
    await cache.set('bob', aliceData);
    await cache.set('charlie', aliceData);
    assert.ok((await cache.getTotalSize()) > 0);
    await cache.clear();
    assert.equal(await cache.get('bob'), null);
    assert.equal(await cache.get('charlie'), null);
    assert.equal(await cache.getTotalSize(), 0);
});

test('createProfileCache enforces LRU eviction when size cap is exceeded', async () => {
    let mockTime = 1000;
    const storage = new MemoryStorageAdapter();

    // Use a small 400-byte cap
    const cache = createProfileCache({
        storage,
        maxSizeBytes: 400,
        now: () => mockTime,
    });

    const makeData = (id) => ({
        posts: { items: [{ id: `post_${id}`, body: 'some content here' }] },
        comments: { items: [] },
    });

    // Store user 1 at t=1000
    mockTime = 1000;
    await cache.set('user1', makeData(1));
    assert.ok(await cache.get('user1'));

    // Store user 2 at t=2000
    mockTime = 2000;
    await cache.set('user2', makeData(2));
    assert.ok(await cache.get('user2'));

    // Access user 1 at t=3000 to refresh its LRU timestamp
    mockTime = 3000;
    await cache.get('user1');

    // Store user 3 at t=4000. This should evict user2 (least recently used, accessed at 2000)
    mockTime = 4000;
    await cache.set('user3', makeData(3));

    assert.ok(await cache.get('user1'), 'user1 should remain because it was accessed recently');
    assert.ok(await cache.get('user3'), 'user3 should be present');
    assert.equal(await cache.get('user2'), null, 'user2 should be evicted by LRU');
});

test('createProfileCache respects lower quota when reported by estimateQuota', async () => {
    const storage = new MemoryStorageAdapter();
    // Browser reports only 200 bytes available
    const mockEstimateQuota = async () => ({ quota: 300, usage: 100 }); // 200 bytes available * 0.8 = 160 bytes

    const cache = createProfileCache({
        storage,
        maxSizeBytes: 100000, // configured high
        estimateQuota: mockEstimateQuota,
    });

    const dataA = { posts: { items: [{ id: 'a', content: 'hello world 123456789' }] }, comments: { items: [] } };
    const dataB = { posts: { items: [{ id: 'b', content: 'hello world 987654321' }] }, comments: { items: [] } };

    await cache.set('userA', dataA);
    assert.ok(await cache.get('userA'));

    // Adding userB triggers eviction of userA because available quota is constrained
    await cache.set('userB', dataB);
    assert.ok(await cache.get('userB'));
    assert.equal(await cache.get('userA'), null, 'userA should be evicted due to quota limit');
});

test('loadProfileWithCache: strictly respects privacy invariant for blocked users', async () => {
    let decoyRan = false;
    let postsResetCalled = false;
    let initialLoadingState = null;

    const mockPosts = {
        hydrate: () => {},
        reset: async () => { postsResetCalled = true; return []; },
        items: [],
        sources: [],
    };
    const mockComments = {
        hydrate: () => {},
        reset: async () => [],
        items: [],
        sources: [],
    };

    await loadProfileWithCache({
        username: 'blocked_user',
        isBlockedUser: async () => true,
        runDecoySearch: async () => { decoyRan = true; },
        posts: mockPosts,
        comments: mockComments,
        setSearchBlocked: () => {},
        setInitialLoading: (val) => { initialLoadingState = val; },
        setCacheInfo: () => {},
        setRefreshing: () => {},
    });

    assert.equal(decoyRan, true, 'Decoy search must run for blocked user');
    assert.equal(postsResetCalled, false, 'Archive reset must never be called for blocked user');
});

