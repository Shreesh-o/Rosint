import { normalizeUsername } from '../normalizeUsername.js';

export const DEFAULT_TRACKED_DATA = Object.freeze({ users: [] });

/**
 * Validates an individual tracked user record.
 * Accepts extra legacy fields (lastCheckedAt, newPosts, newComments) and ignores them.
 */
export function isValidTrackedUser(u) {
    if (typeof u !== 'object' || u === null || Array.isArray(u)) return false;
    if (typeof u.username !== 'string' || u.username.trim().length === 0) return false;
    if (typeof u.addedAt !== 'number' || !Number.isFinite(u.addedAt)) return false;
    return true;
}

/**
 * Validates the full tracked users data shape.
 */
export function isValidTrackedData(data) {
    if (typeof data !== 'object' || data === null || Array.isArray(data)) return false;
    if (!Array.isArray(data.users)) return false;
    return data.users.every(isValidTrackedUser);
}

/**
 * Pure helper: adds a user to a tracked data object.
 * Normalizes username, deduplicates case-insensitively, and sets defaults.
 */
export function addTrackedUser(data, rawUsername, { now = () => Math.floor(Date.now() / 1000) } = {}) {
    if (!isValidTrackedData(data)) {
        throw new Error('Invalid tracked users data shape');
    }
    const clean = normalizeUsername(rawUsername);
    if (!clean) {
        throw new Error('Invalid username');
    }
    const lower = clean.toLowerCase();
    const exists = data.users.some(u => u.username.toLowerCase() === lower);
    if (exists) {
        return { users: [...data.users] };
    }
    const addedAt = typeof now === 'function' ? now() : now;
    const newUser = {
        username: clean,
        addedAt,
    };
    return {
        users: [...data.users, newUser],
    };
}

/**
 * Pure helper: removes a user from a tracked data object (case-insensitively).
 */
export function removeTrackedUser(data, rawUsername) {
    if (!isValidTrackedData(data)) {
        throw new Error('Invalid tracked users data shape');
    }
    const clean = normalizeUsername(rawUsername);
    if (!clean) {
        return { users: [...data.users] };
    }
    const lower = clean.toLowerCase();
    return {
        users: data.users.filter(u => u.username.toLowerCase() !== lower),
    };
}

/**
 * Fetches the tracked users list from /api/tracked.
 * Returns null if the endpoint is unavailable or returns an error (e.g. in production).
 */
export async function loadTracked({ fetcher = fetch, endpoint = '/api/tracked' } = {}) {
    try {
        const res = await fetcher(endpoint, {
            headers: { Accept: 'application/json' },
        });
        if (!res || !res.ok) return null;
        const data = await res.json();
        if (!isValidTrackedData(data)) return null;
        return data;
    } catch {
        return null;
    }
}

/**
 * Saves the tracked users list by PUTing it to /api/tracked.
 */
export async function saveTracked(data, { fetcher = fetch, endpoint = '/api/tracked' } = {}) {
    if (!isValidTrackedData(data)) {
        throw new Error('Invalid tracked users data shape');
    }
    const res = await fetcher(endpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!res || !res.ok) {
        throw new Error(`Failed to save tracked users: ${res?.status ?? 'network error'}`);
    }
    return res.json().catch(() => ({ ok: true }));
}

/**
 * Adds a user to tracked users.
 * Supports both pure usage `addUser(data, username, options)` and
 * async endpoint usage `await addUser(username, options)`.
 */
export async function addUser(target, rawUsernameOrOptions, options = {}) {
    if (typeof target === 'object' && target !== null && Array.isArray(target.users)) {
        return addTrackedUser(target, rawUsernameOrOptions, options);
    }
    const rawUsername = target;
    const opts = rawUsernameOrOptions || {};
    const { fetcher = fetch, endpoint = '/api/tracked', now } = opts;
    const current = await loadTracked({ fetcher, endpoint });
    if (!current) {
        throw new Error('Tracked users endpoint unavailable');
    }
    const updated = addTrackedUser(current, rawUsername, { now });
    await saveTracked(updated, { fetcher, endpoint });
    return updated;
}

/**
 * Removes a user from tracked users.
 * Supports both pure usage `removeUser(data, username)` and
 * async endpoint usage `await removeUser(username, options)`.
 */
export async function removeUser(target, rawUsernameOrOptions) {
    if (typeof target === 'object' && target !== null && Array.isArray(target.users)) {
        return removeTrackedUser(target, rawUsernameOrOptions);
    }
    const rawUsername = target;
    const opts = rawUsernameOrOptions || {};
    const { fetcher = fetch, endpoint = '/api/tracked' } = opts;
    const current = await loadTracked({ fetcher, endpoint });
    if (!current) {
        throw new Error('Tracked users endpoint unavailable');
    }
    const updated = removeTrackedUser(current, rawUsername);
    await saveTracked(updated, { fetcher, endpoint });
    return updated;
}
