import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractPostMediaKey, groupDuplicates } from '../src/lib/dedupePosts.js';

test('extractPostMediaKey normalizes URLs, strips tracking params, and handles media', () => {
    // Strips tracking params
    const key1 = extractPostMediaKey({
        is_self: false,
        url: 'https://Example.com/path/?utm_source=twitter&utm_medium=social#heading',
    });
    const key2 = extractPostMediaKey({
        is_self: false,
        url: 'https://example.com/path?share_id=123',
    });
    assert.equal(key1, 'https://example.com/path');
    assert.equal(key2, 'https://example.com/path');
    assert.equal(key1, key2);

    // Preserves non-tracking query parameters in deterministic sorted order
    const keyWithParams1 = extractPostMediaKey({
        is_self: false,
        url: 'https://www.youtube.com/watch?v=123&t=40&utm_source=reddit',
    });
    const keyWithParams2 = extractPostMediaKey({
        is_self: false,
        url: 'https://youtube.com/watch?t=40&v=123',
    });
    assert.equal(keyWithParams1, 'https://youtube.com/watch?t=40&v=123');
    assert.equal(keyWithParams2, 'https://youtube.com/watch?t=40&v=123');
    assert.equal(keyWithParams1, keyWithParams2);

    // url_overridden_by_dest takes precedence
    const keyDest = extractPostMediaKey({
        is_self: false,
        url: 'https://reddit.com/r/pics/comments/123/title',
        url_overridden_by_dest: 'https://i.redd.it/xyz789.jpg',
    });
    assert.equal(keyDest, 'media:redd.it/xyz789');

    // Gallery media id
    const keyGallery = extractPostMediaKey({
        is_self: false,
        gallery_data: { items: [{ media_id: 'galleryMedia123' }] },
    });
    assert.equal(keyGallery, 'media:gallery/gallerymedia123');
});

test('Same URL in different subreddits gets grouped, newest kept', () => {
    const posts = [
        { id: 'post_1', subreddit: 'pics', created_utc: 1000, url: 'https://example.com/image.png' },
        { id: 'post_2', subreddit: 'aww', created_utc: 2000, url: 'https://example.com/image.png' },
        { id: 'post_3', subreddit: 'cats', created_utc: 1500, url: 'https://example.com/image.png' },
    ];

    const { visible, hiddenCount, groups } = groupDuplicates(posts);

    assert.equal(hiddenCount, 2);
    assert.equal(visible.length, 1);
    assert.equal(visible[0].id, 'post_2'); // newest kept

    assert.ok(groups['post_2']);
    assert.equal(groups['post_2'].length, 2);
    const dupSubreddits = groups['post_2'].map(p => p.subreddit);
    assert.ok(dupSubreddits.includes('pics'));
    assert.ok(dupSubreddits.includes('cats'));
});

test('URLs differing only by tracking params are treated as duplicates', () => {
    const posts = [
        { id: 'p1', created_utc: 500, url: 'https://news.ycombinator.com/item?id=123&utm_source=twitter' },
        { id: 'p2', created_utc: 800, url: 'https://news.ycombinator.com/item?id=123&share_id=abc&utm_medium=email' },
    ];

    const { visible, hiddenCount, groups } = groupDuplicates(posts);

    assert.equal(hiddenCount, 1);
    assert.equal(visible.length, 1);
    assert.equal(visible[0].id, 'p2');
    assert.equal(groups['p2'][0].id, 'p1');
});

test('i.redd.it and preview.redd.it with same ID are grouped', () => {
    const posts = [
        { id: 'img_i', created_utc: 100, url: 'https://i.redd.it/sunset123.jpg' },
        { id: 'img_prev', created_utc: 300, url: 'https://preview.redd.it/sunset123.png?width=960&crop=smart&auto=webp' },
    ];

    const { visible, hiddenCount, groups } = groupDuplicates(posts);

    assert.equal(hiddenCount, 1);
    assert.equal(visible.length, 1);
    assert.equal(visible[0].id, 'img_prev'); // newest kept
    assert.equal(groups['img_prev'][0].id, 'img_i');
});

test('Self posts are never grouped', () => {
    const posts = [
        { id: 'self_1', is_self: true, created_utc: 100, url: 'https://example.com/same-url' },
        { id: 'self_2', is_self: true, created_utc: 200, url: 'https://example.com/same-url' },
        { id: 'self_domain', domain: 'self.AskReddit', created_utc: 300, url: 'https://example.com/same-url' },
    ];

    const { visible, hiddenCount, groups } = groupDuplicates(posts);

    assert.equal(hiddenCount, 0);
    assert.equal(visible.length, 3);
    assert.deepEqual(groups, {});
});

test('Reddit permalinks are never grouped', () => {
    const posts = [
        { id: 'perma_1', is_self: false, created_utc: 100, url: 'https://www.reddit.com/r/technology/comments/abc/discussion/' },
        { id: 'perma_2', is_self: false, created_utc: 200, url: 'https://reddit.com/r/technology/comments/abc/discussion/' },
        { id: 'perma_short', is_self: false, created_utc: 300, url: 'https://redd.it/abc' },
    ];

    const { visible, hiddenCount, groups } = groupDuplicates(posts);

    assert.equal(hiddenCount, 0);
    assert.equal(visible.length, 3);
    assert.deepEqual(groups, {});
});

test('Single posts are untouched', () => {
    const posts = [
        { id: 'single_1', created_utc: 100, url: 'https://example.com/unique-1' },
        { id: 'single_2', created_utc: 200, url: 'https://example.com/unique-2' },
        { id: 'single_3', created_utc: 300, url: 'https://i.redd.it/unique-3.jpg' },
    ];

    const { visible, hiddenCount, groups } = groupDuplicates(posts);

    assert.equal(hiddenCount, 0);
    assert.equal(visible.length, 3);
    assert.deepEqual(groups, {});
});

test('Newest post is always the one kept visible', () => {
    const posts = [
        { id: 'oldest', created_utc: 100, url: 'https://example.com/target' },
        { id: 'newest', created_utc: 999, url: 'https://example.com/target' },
        { id: 'middle', created_utc: 500, url: 'https://example.com/target' },
    ];

    const { visible, hiddenCount, groups } = groupDuplicates(posts);

    assert.equal(hiddenCount, 2);
    assert.equal(visible.length, 1);
    assert.equal(visible[0].id, 'newest');
    assert.equal(groups['newest'].length, 2);
    assert.equal(groups['newest'][0].id, 'middle');
    assert.equal(groups['newest'][1].id, 'oldest');
});

test('Handles empty and invalid inputs gracefully without throwing', () => {
    assert.deepEqual(groupDuplicates([]), { visible: [], hiddenCount: 0, groups: {} });
    assert.deepEqual(groupDuplicates(null), { visible: [], hiddenCount: 0, groups: {} });
    assert.deepEqual(groupDuplicates(undefined), { visible: [], hiddenCount: 0, groups: {} });
});
