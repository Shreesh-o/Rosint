/**
 * Pure helper for deduplicating posts sharing the same target URL or media ID.
 * View-only: never mutates input data or cache.
 */

const TRACKING_PARAM_PREFIXES = ['utm_'];
const TRACKING_PARAM_EXACT = new Set([
    'share_id',
    'ref',
    'ref_source',
    'ref_campaign',
    'fbclid',
    'gclid',
    'si',
    'feature',
    'context',
    'rdt',
]);

/**
 * Extracts a normalized media or URL key for a post.
 * Returns null if the post is ineligible (self posts, permalinks, invalid URLs).
 */
export function extractPostMediaKey(post) {
    if (!post || typeof post !== 'object') return null;

    // Ineligible: self (text) posts
    if (post.is_self) return null;
    if (typeof post.domain === 'string' && post.domain.toLowerCase().startsWith('self.')) return null;

    // Check gallery media ID first
    const galleryItems = post.gallery_data?.items;
    if (Array.isArray(galleryItems) && galleryItems.length > 0 && galleryItems[0]?.media_id) {
        return `media:gallery/${String(galleryItems[0].media_id).toLowerCase().trim()}`;
    }
    if (post.media_metadata && typeof post.media_metadata === 'object') {
        const keys = Object.keys(post.media_metadata);
        if (keys.length > 0 && keys[0]) {
            return `media:gallery/${String(keys[0]).toLowerCase().trim()}`;
        }
    }

    const rawUrl = post.url_overridden_by_dest || post.url;
    if (!rawUrl || typeof rawUrl !== 'string') return null;

    let parsed;
    try {
        parsed = new URL(rawUrl);
    } catch {
        return null;
    }

    let host = parsed.hostname.toLowerCase().replace(/^www\./, '');

    // Ineligible: internal reddit permalinks
    if (host === 'redd.it') return null;
    if (host === 'reddit.com' || host.endsWith('.reddit.com')) {
        if (parsed.pathname.includes('/comments/')) return null;
    }

    // Treat i.redd.it/<id> and preview.redd.it/<id> as the same media ID
    if (host === 'i.redd.it' || host === 'preview.redd.it') {
        const segments = parsed.pathname.split('/').filter(Boolean);
        const filename = segments.pop() || '';
        const mediaId = filename.replace(/\.[^/.]+$/, '').toLowerCase();
        if (mediaId) {
            return `media:redd.it/${mediaId}`;
        }
    }

    // Strip tracking/query params
    const searchParams = new URLSearchParams(parsed.search);
    const toDelete = [];
    for (const key of searchParams.keys()) {
        const lower = key.toLowerCase();
        if (TRACKING_PARAM_EXACT.has(lower) || TRACKING_PARAM_PREFIXES.some(prefix => lower.startsWith(prefix))) {
            toDelete.push(key);
        }
    }
    for (const key of toDelete) {
        searchParams.delete(key);
    }
    searchParams.sort();

    // Strip trailing slashes and hash fragments (hash is omitted automatically)
    const cleanPath = parsed.pathname.replace(/\/+$/, '');
    const cleanSearch = searchParams.toString();
    return `${parsed.protocol}//${host}${cleanPath}${cleanSearch ? '?' + cleanSearch : ''}`;
}

/**
 * Groups an array of posts by target URL / media ID.
 * For groups of >= 2 posts, keeps the newest post (highest created_utc) as visible
 * and marks the remaining posts as hidden duplicates.
 *
 * @param {Array} posts
 * @returns {{ visible: Array, hiddenCount: number, groups: Record<string, Array> }}
 */
export function groupDuplicates(posts) {
    if (!Array.isArray(posts) || posts.length === 0) {
        return { visible: [], hiddenCount: 0, groups: {} };
    }

    // Map: key -> array of posts
    const keyMap = new Map();
    const ineligiblePosts = [];

    for (const post of posts) {
        const key = extractPostMediaKey(post);
        if (!key) {
            ineligiblePosts.push(post);
            continue;
        }
        let list = keyMap.get(key);
        if (!list) {
            list = [];
            keyMap.set(key, list);
        }
        list.push(post);
    }

    const hiddenIds = new Set();
    const groups = {}; // visiblePost.id -> array of duplicate posts
    let hiddenCount = 0;

    for (const [, list] of keyMap.entries()) {
        if (list.length >= 2) {
            // Sort descending by created_utc, tiebreak deterministically by id
            const sorted = list.slice().sort((a, b) => {
                const diff = (b.created_utc || 0) - (a.created_utc || 0);
                if (diff !== 0) return diff;
                return String(a.id || '').localeCompare(String(b.id || ''));
            });

            const newest = sorted[0];
            const duplicates = sorted.slice(1);

            groups[newest.id] = duplicates;
            hiddenCount += duplicates.length;

            for (const dup of duplicates) {
                hiddenIds.add(dup.id);
            }
        }
    }

    // Preserve original input order for visible posts
    const visible = posts.filter(post => !hiddenIds.has(post.id));

    return { visible, hiddenCount, groups };
}
