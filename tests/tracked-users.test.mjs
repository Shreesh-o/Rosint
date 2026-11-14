import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import {
    isValidTrackedData,
    isValidTrackedUser,
    addTrackedUser,
    removeTrackedUser,
    loadTracked,
    saveTracked,
    addUser,
    removeUser,
} from '../src/lib/trackedUsers.js';
import { trackedUsersPlugin } from '../vite-plugin-tracked-users.js';

const mockNow = () => 1700000000;

test('isValidTrackedUser validates required fields and types', () => {
    const valid = {
        username: 'spez',
        addedAt: 1700000000,
    };
    assert.equal(isValidTrackedUser(valid), true);

    // Old format with extra fields is also valid (fields ignored)
    assert.equal(isValidTrackedUser({
        ...valid,
        lastCheckedAt: 1700000500,
        newPosts: 3,
        newComments: 1,
    }), true);

    // Invalid cases
    assert.equal(isValidTrackedUser(null), false);
    assert.equal(isValidTrackedUser({ ...valid, username: '' }), false);
    assert.equal(isValidTrackedUser({ ...valid, username: '   ' }), false);
    assert.equal(isValidTrackedUser({ ...valid, addedAt: '1700000000' }), false);
    assert.equal(isValidTrackedUser({ ...valid, addedAt: NaN }), false);
});

test('isValidTrackedData validates data shape', () => {
    assert.equal(isValidTrackedData({ users: [] }), true);
    assert.equal(isValidTrackedData({
        users: [{
            username: 'alice',
            addedAt: 1700000000,
        }],
    }), true);

    assert.equal(isValidTrackedData(null), false);
    assert.equal(isValidTrackedData([]), false);
    assert.equal(isValidTrackedData({}), false);
    assert.equal(isValidTrackedData({ users: 'not-an-array' }), false);
    assert.equal(isValidTrackedData({ users: [{ invalid: true }] }), false);
});

test('addTrackedUser normalizes username, sets defaults, and uses injected now', () => {
    const initial = { users: [] };

    // Normalization: u/ prefix
    const res1 = addTrackedUser(initial, 'u/spez', { now: mockNow });
    assert.equal(res1.users.length, 1);
    assert.deepEqual(res1.users[0], {
        username: 'spez',
        addedAt: 1700000000,
    });

    // Normalization: full reddit URL and @ prefix
    const res2 = addTrackedUser(res1, 'https://reddit.com/user/GallowBoob', { now: () => 1700000100 });
    assert.equal(res2.users.length, 2);
    assert.equal(res2.users[1].username, 'GallowBoob');
    assert.equal(res2.users[1].addedAt, 1700000100);

    const res3 = addTrackedUser(res2, '@kn0thing', { now: mockNow });
    assert.equal(res3.users.length, 3);
    assert.equal(res3.users[2].username, 'kn0thing');
});

test('addTrackedUser de-duplicates case-insensitively without mutating', () => {
    const initial = {
        users: [{
            username: 'Spez',
            addedAt: 1700000000,
        }],
    };

    // Adding existing user in different case
    const res = addTrackedUser(initial, 'u/spez', { now: () => 1700000999 });
    assert.equal(res.users.length, 1);
    assert.deepEqual(res.users[0], initial.users[0]); // keeps original entry intact
    assert.notEqual(res, initial); // returns a new reference
});

test('addTrackedUser throws on empty username or invalid data shape', () => {
    assert.throws(() => addTrackedUser({ users: [] }, ''), /Invalid username/);
    assert.throws(() => addTrackedUser({ users: [] }, '   '), /Invalid username/);
    assert.throws(() => addTrackedUser({ users: [] }, 'u/'), /Invalid username/);
    assert.throws(() => addTrackedUser(null, 'spez'), /Invalid tracked users data shape/);
});

test('removeTrackedUser removes user case-insensitively with normalization', () => {
    const initial = {
        users: [
            { username: 'Spez', addedAt: 1700000000 },
            { username: 'GallowBoob', addedAt: 1700000000 },
        ],
    };

    // Remove with lowercase and u/ prefix
    const res1 = removeTrackedUser(initial, 'u/spez');
    assert.equal(res1.users.length, 1);
    assert.equal(res1.users[0].username, 'GallowBoob');

    // Removing non-existent user leaves list intact
    const res2 = removeTrackedUser(res1, 'nonexistent');
    assert.equal(res2.users.length, 1);
    assert.equal(res2.users[0].username, 'GallowBoob');

    // Remove remaining user
    const res3 = removeTrackedUser(res2, 'gallowboob');
    assert.equal(res3.users.length, 0);
});

test('removeTrackedUser throws on invalid data shape', () => {
    assert.throws(() => removeTrackedUser(null, 'spez'), /Invalid tracked users data shape/);
});

test('loadTracked returns parsed data on success and null on failure or error', async () => {
    // Successful response
    const mockSuccessFetcher = async () => new Response(JSON.stringify({
        users: [{ username: 'spez', addedAt: 1700000000 }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });

    const loaded = await loadTracked({ fetcher: mockSuccessFetcher });
    assert.equal(loaded?.users.length, 1);
    assert.equal(loaded?.users[0].username, 'spez');

    // 404 (endpoint unavailable, e.g. in production build)
    const mock404Fetcher = async () => new Response(JSON.stringify({ error: 'Endpoint not found' }), { status: 404 });
    assert.equal(await loadTracked({ fetcher: mock404Fetcher }), null);

    // Network error
    const mockErrorFetcher = async () => { throw new TypeError('Network down'); };
    assert.equal(await loadTracked({ fetcher: mockErrorFetcher }), null);

    // Malformed JSON / invalid data shape
    const mockBadDataFetcher = async () => new Response(JSON.stringify({ unexpected: true }), { status: 200 });
    assert.equal(await loadTracked({ fetcher: mockBadDataFetcher }), null);
});

test('saveTracked PUTs valid data and throws on failure', async () => {
    let capturedUrl = '';
    let capturedOptions = null;

    const mockFetcher = async (url, options) => {
        capturedUrl = url;
        capturedOptions = options;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    const validData = {
        users: [{ username: 'spez', addedAt: 1700000000 }],
    };

    await saveTracked(validData, { fetcher: mockFetcher, endpoint: '/api/tracked' });
    assert.equal(capturedUrl, '/api/tracked');
    assert.equal(capturedOptions.method, 'PUT');
    assert.equal(capturedOptions.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(capturedOptions.body), validData);

    // Throws on invalid data shape before fetch
    await assert.rejects(() => saveTracked({ users: 'invalid' }, { fetcher: mockFetcher }), /Invalid tracked users data shape/);

    // Throws when fetcher returns 500
    const mockFailedFetcher = async () => new Response('Internal error', { status: 500 });
    await assert.rejects(() => saveTracked(validData, { fetcher: mockFailedFetcher }), /Failed to save tracked users/);
});

test('addUser and removeUser coordinate load and save with endpoint', async () => {
    let serverStore = { users: [] };

    const mockFetcher = async (url, options = {}) => {
        if (!options.method || options.method === 'GET') {
            return new Response(JSON.stringify(serverStore), { status: 200 });
        }
        if (options.method === 'PUT') {
            serverStore = JSON.parse(options.body);
            return new Response(JSON.stringify({ ok: true, data: serverStore }), { status: 200 });
        }
        return new Response('Method Not Allowed', { status: 405 });
    };

    // addUser fetches current data, appends, and saves
    const res1 = await addUser('u/Spez', { fetcher: mockFetcher, now: mockNow });
    assert.equal(res1.users.length, 1);
    assert.equal(res1.users[0].username, 'Spez');
    assert.equal(serverStore.users.length, 1);

    // addUser deduplicates against server store
    const res2 = await addUser('spez', { fetcher: mockFetcher, now: mockNow });
    assert.equal(res2.users.length, 1);

    // addUser adds another user
    await addUser('GallowBoob', { fetcher: mockFetcher, now: mockNow });
    assert.equal(serverStore.users.length, 2);

    // removeUser fetches current data, removes, and saves
    const res3 = await removeUser('spez', { fetcher: mockFetcher });
    assert.equal(res3.users.length, 1);
    assert.equal(res3.users[0].username, 'GallowBoob');
    assert.equal(serverStore.users.length, 1);
    assert.equal(serverStore.users[0].username, 'GallowBoob');

    // Pure functional overload tests: addUser(data, user) and removeUser(data, user)
    const pureAdd = await addUser({ users: [] }, 'alice', { now: mockNow });
    assert.equal(pureAdd.users.length, 1);
    assert.equal(pureAdd.users[0].username, 'alice');

    const pureRemove = await removeUser(pureAdd, 'alice');
    assert.equal(pureRemove.users.length, 0);
});

test('vite-plugin-tracked-users serves GET, handles missing file, and performs atomic PUT writes', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracked-test-'));
    const plugin = trackedUsersPlugin({ dataDir: tempDir, fileName: 'tracked-users.json' });

    let middleware = null;
    plugin.configureServer({
        middlewares: {
            use(fn) {
                middleware = fn;
            },
        },
    });
    assert.equal(typeof middleware, 'function');

    // Helper to simulate request/response through Connect middleware
    const execute = (method, urlPath, body = null) => new Promise((resolve) => {
        const req = new EventEmitter();
        req.method = method;
        req.url = urlPath;

        const headers = {};
        const res = {
            statusCode: 200,
            setHeader(name, value) { headers[name] = value; },
            end(data) {
                resolve({ statusCode: res.statusCode, headers, data: data ? JSON.parse(data) : null });
            },
        };

        let nextCalled = false;
        middleware(req, res, () => { nextCalled = true; resolve({ nextCalled: true }); });

        if (body !== null) {
            req.emit('data', Buffer.from(JSON.stringify(body)));
        }
        req.emit('end');
    });

    // 1. Non-tracked route passes through to next()
    const nonTracked = await execute('GET', '/api/other');
    assert.equal(nonTracked.nextCalled, true);

    // 2. GET /api/tracked when file does not exist returns default empty users array
    const initialGet = await execute('GET', '/api/tracked');
    assert.equal(initialGet.statusCode, 200);
    assert.deepEqual(initialGet.data, { users: [] });

    // 3. PUT /api/tracked with invalid data returns 400
    const badPut = await execute('PUT', '/api/tracked', { invalid: 'data' });
    assert.equal(badPut.statusCode, 400);

    // 4. PUT /api/tracked with valid data writes file atomically
    const validPayload = {
        users: [{
            username: 'spez',
            addedAt: 1700000000,
        }],
    };
    const goodPut = await execute('PUT', '/api/tracked', validPayload);
    assert.equal(goodPut.statusCode, 200);
    assert.equal(goodPut.data.ok, true);

    // File was written to disk
    const savedOnDisk = JSON.parse(fs.readFileSync(path.join(tempDir, 'tracked-users.json'), 'utf8'));
    assert.deepEqual(savedOnDisk, validPayload);

    // 5. GET /api/tracked now reads written file
    const secondGet = await execute('GET', '/api/tracked');
    assert.equal(secondGet.statusCode, 200);
    assert.deepEqual(secondGet.data, validPayload);

    // 6. Cleanup
    fs.rmSync(tempDir, { recursive: true, force: true });
});

test('old-format data with legacy fields (lastCheckedAt, newPosts, newComments) still loads and validates', async () => {
    const legacyPayload = {
        users: [
            {
                username: 'spez',
                addedAt: 1700000000,
                lastCheckedAt: 1700000500,
                newPosts: 5,
                newComments: 12,
            },
            {
                username: 'kn0thing',
                addedAt: 1700000100,
                lastCheckedAt: null,
                newPosts: 0,
                newComments: 0,
            },
        ],
    };

    // 1. isValidTrackedData validates legacy data
    assert.equal(isValidTrackedData(legacyPayload), true);

    // 2. loadTracked loads and returns legacy data
    const mockFetcher = async () => new Response(JSON.stringify(legacyPayload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
    const loaded = await loadTracked({ fetcher: mockFetcher });
    assert.deepEqual(loaded, legacyPayload);
});
