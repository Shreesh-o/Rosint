# Rosint (redditOSINT) — Project Guide

## Overview
Rosint is a client-side Reddit intelligence tool that queries independent public archives (Arctic Shift and PullPush) directly from the browser. It merges and deduplicates post and comment histories, revealing deleted posts and mod-removed comments without requiring Reddit API keys or credentials. It includes an opt-out restriction system (static SHA-256 hashes + dynamic removal service API) and operator CLI scripts.

## Verified Commands
- **Runtime:** Node.js ≥ 24 (`v26.13.1` verified)
- **Install:** `npm ci` (configured with `.npmrc` `legacy-peer-deps=true`)
- **Dev Server:** `npm run dev` (starts Vite on `http://localhost:5173`)
- **Test:** `npm test` (`node --test tests/*.test.mjs` — 82 unit tests)
- **Lint:** `npm run lint` (`eslint .` — 0 errors, 1 known warning)
- **Build:** `npm run build` (Vite production build to `dist/`)
- **Preview:** `npm run preview` (previews `dist/`)
- **Worker Check:** `npm run deploy:check` (`wrangler deploy --dry-run`)

## Architecture & Directory Map
```
Rosint/
├── src/
│   ├── main.jsx             # React DOM entry point, canonical domain redirect
│   ├── App.jsx              # Main UI monolith: search state, archive queries, result cards, charts, dino game
│   ├── blocklist.js         # Removal service client (createBlocklistClient) with 30s cache & fail-closed fallback
│   ├── normalizeUsername.js # Cleans usernames (strips u/, URLs, @, slashes); shared by UI and CLI scripts
│   ├── postLookup.js        # Batched & cached post ID queries (createPostLookup) and retry logic (fetchWithBackoff)
│   ├── components/
│   │   ├── TrackedUsers.jsx # TrackedUsers list & TrackToggle button components
│   │   ├── ProfileCache.jsx # CacheBanner & ClearCacheButton components
│   │   ├── DedupeToggle.jsx # DedupeToggle component for duplicate post filtering
│   │   └── MediaPostCard.jsx# Dark-mode card for posts with images, galleries, and videos
│   ├── lib/
│   │   ├── trackedUsers.js  # Tracked users helpers (loadTracked, saveTracked, addUser, removeUser)
│   │   ├── profileCache.js  # Stale-while-revalidate IndexedDB cache with LRU eviction and merge logic
│   │   ├── dedupePosts.js   # Pure helper for post URL/media extraction and duplicate grouping
│   │   └── postMedia.js     # Media detection (hasMedia, getPostMedia), cleanMediaUrl, and formatting helpers
│   └── index.css            # Tailwind directives
├── worker/
│   └── index.js             # Cloudflare Worker handler: redirects /admin and /removal, proxies /api/config & /api/blocklist
├── scripts/
│   ├── lookup.mjs           # CLI: Archive summary for a username
│   ├── triage.mjs           # CLI: AI policy screening (Gemini API with Cloudflare Workers AI fallback)
│   ├── block.mjs            # CLI: Appends normalized SHA-256 hash to BLOCKED_HASHES in src/App.jsx
│   ├── removal-reply.mjs    # CLI: Generates removal confirmation email template
│   └── lib/archive.mjs      # Shared CLI archive fetcher, summary aggregator, and content sampler
├── tests/
│   ├── backoff.test.mjs     # Unit tests for fetchWithBackoff, backoffDelayMs, and retryAfterMs
│   ├── post-lookup.test.mjs # Unit tests for createPostLookup batching, deduplication, and caching
│   ├── search-service.test.mjs # Unit tests for createBlocklistClient and Worker proxy handler
│   ├── tracked-users.test.mjs  # Unit tests for tracked user data validation, normalization, and persistence
│   ├── profile-cache.test.mjs  # Unit tests for profile cache key normalization, merging, LRU eviction, and quota
│   ├── dedupe-posts.test.mjs   # Unit tests for duplicate post URL normalization and grouping
│   └── media-post.test.mjs    # Unit tests for media detection, URL entity cleaning, and card formatters
├── vite-plugin-tracked-users.js # Dev-only Vite plugin serving /api/tracked backed by data/tracked-users.json
├── vite.config.js           # Vite config with React plugin, tracked users plugin, and proxy /api -> http://127.0.0.1:8787
├── wrangler.jsonc           # Cloudflare Worker configuration (routing, assets, services binding)
└── .env.example             # Optional env config (GEMINI_API_KEY, VITE_REMOVAL_SERVICE_ORIGIN)
```

## Data Flow
1. **User input:** Username entered or read from `?u=<user>` query param.
2. **Normalization:** `normalizeUsername()` strips prefixes and URLs.
3. **Restriction check:** `isBlockedUser()` computes SHA-256 hash, checks static `BLOCKED_HASHES` in `App.jsx`, then calls `dynamicallyBlocked()` in `blocklist.js`. If blocked, `runDecoySearch()` triggers a fake 1–3s delay and returns empty results without querying archives.
4. **Cache & Fetch:** `loadProfileWithCache()` verifies user is not blocked, hydrates from IndexedDB on hit, and revalidates in the background via `fetchBoth()`.
5. **Merge & Filter:** Items merged by ID, filtered client-side (NSFW, deleted-only, duplicate post hiding), and sorted by `created_utc`.
6. **Rendering:** `hasMedia(post)` routes posts to `MediaPostCard` (media) or `PostCard` (text / plain links). Comments hydrate parent titles via `lookupPost()`.

## Coding Conventions
- **Language & Styling:** Plain JavaScript / JSX (React 19), Tailwind CSS classes. No TypeScript.
- **Testability:** Injectable I/O dependencies (`fetcher`, `wait`, `schedule`, `now`, `random`). Avoid global mocks.
- **Error handling:** Fail-soft for public archives (`safeFetch` returns `{ data: [], ok: false }`); fail-closed for removal checks (`blocklist.js` returns `true` on error).

## Gotchas & Fragile Areas
- **`App.jsx` Monolith:** Contains over 2,700 lines. The static array `const BLOCKED_HASHES = [...]` must retain its exact marker syntax because `scripts/block.mjs` parses and rewrites it via string matching.
- **Privacy / Decoy Invariant:** Never fire archive API queries or read/write cache for blocked accounts. `UserSummary` and `TrackToggle` are suppressed when `searchBlocked` is true.
- **Shared Helpers & Duplication:** Formatting helpers (`timeAgo`, `fullTimestamp`, `fmtNum`, `getStatus`, `statusBorder`) now live in `src/lib/postMedia.js` and are imported by `App.jsx` to prevent duplication while keeping `App.jsx` exporting only components (preserving Vite Fast Refresh). The duplication of ARCTIC/PULLPUSH URLs and `safeFetch` with `scripts/lib/archive.mjs` remains known debt.
- **Client-Side Sorting & Pagination:** Sorting (Newest, Oldest, Top) re-sorts the current page (≤100 items), not the complete archive dataset. Pagination uses timestamp cursors (`before=` / `after=`).

## Verification Checklist
Before submitting changes:
- [ ] `npm test` passes all 82 tests.
- [ ] `npm run lint` reports 0 errors (1 warning in `App.jsx` is baseline).
- [ ] `npm run build` finishes without errors.
- [ ] Launch `npm run dev` and test:
  - Standard search: `http://localhost:5173/?u=spez`
  - Comment tree expansion and parent post cards
  - Date and keyword filters
  - Maintenance screen: `http://localhost:5173/?dino`

## Key Extension Features

### 1. Profile Cache (Stale-While-Revalidate)
- **Files:** `src/lib/profileCache.js`, `src/components/ProfileCache.jsx`, `tests/profile-cache.test.mjs`
- **Purpose:** Instant profile loading on repeat visits backed by raw IndexedDB (`rosint_cache`, store `profiles`), with background revalidation and LRU size capping (~1.5 GB).
- **Key Functions:** `loadProfileWithCache`, `createProfileCache`, `mergeItemsById`, `clearProfileCache`.
- **Privacy Rule:** `isBlockedUser()` always executes BEFORE any cache read. Blocked users immediately trigger `deleteCachedProfile()` and decoy search; nothing is ever read from or cached for blocked users.

### 2. Duplicate Posts Filter
- **Files:** `src/lib/dedupePosts.js`, `src/components/DedupeToggle.jsx`, `tests/dedupe-posts.test.mjs`
- **Purpose:** Client-side view filter hiding crossposted duplicate media and link posts (keeping the newest post visible and annotating it with "also in r/x, r/y").
- **Key Functions:** `groupDuplicates`, `extractPostMediaKey`, `DedupeToggle`.
- **Privacy Rule:** Purely client-side on loaded items; zero network requests and never active or rendered for blocked/decoy searches.

### 3. Media Post Cards
- **Files:** `src/lib/postMedia.js`, `src/components/MediaPostCard.jsx`, `tests/media-post.test.mjs`
- **Purpose:** Mobile dark-mode presentation for posts with images, galleries, and videos, with lazy/async loading, `preload="none"`, and broken-media fallback placeholders.
- **Key Rule:** `hasMedia(post)` drives conditional rendering: media posts render with `MediaPostCard`; text posts and plain link posts keep the original `PostCard`.
- **Key Functions:** `hasMedia`, `getPostMedia`, `cleanMediaUrl`, `fmtNum`, `timeAgo`, `getStatus`, `statusBorder`, `isRemovedImagePlaceholder`, `isAllowedPlaceholderHost`, `getRecoveryUrl`.
- **Removed Image Placeholder Detection:** Detects host-served "image removed / deleted" graphics via `isRemovedImagePlaceholder({ url, width, height })` in `onLoad` across single images, recovery previews, and gallery slides.
  - **Allowed Hosts:** `imgur.com` and its subdomains, `i.redd.it`, `preview.redd.it`, `external-preview.redd.it`.
  - **Known Sizes:** Maintained in `KNOWN_REMOVED_PLACEHOLDER_SIZES` in `src/lib/postMedia.js` (currently `161x81` and `130x60`). To add a newly discovered placeholder size, append `{ width: W, height: H }` to `KNOWN_REMOVED_PLACEHOLDER_SIZES`.
- **Media Fallback Chain:** Failed images attempt Reddit-hosted preview recovery via `getRecoveryUrl` (annotated with "Original deleted on host · showing Reddit preview"). If recovery fails, or if the recovery image is itself a removed placeholder, the card transitions directly to the final failed state showing "Image was deleted (placeholder only)" while keeping the "Open original" link.
- **Privacy Rule:** Pure presentation formatting on already loaded posts. Zero network queries; never rendered for blocked/decoy searches.

### 4. Tracked Users
- **Files:** `src/lib/trackedUsers.js`, `src/components/TrackedUsers.jsx`, `vite-plugin-tracked-users.js`, `tests/tracked-users.test.mjs`
- **Purpose:** Local dev-only tracking list stored in `data/tracked-users.json` via dev-server API (`/api/tracked`). Automatically hidden in production builds.
- **Privacy Rule:** Blocked users trigger normal decoy search delay without querying archives; `TrackToggle` is hidden on blocked searches.

### 5. Subreddit Mode
- **Files:** `src/lib/subredditScan.js`, `src/components/SubredditMode.jsx`, `tests/subreddit-scan.test.mjs`
- **URL Parameter & Precedence:** `?r=<subreddit>` (mutually exclusive with `?u=<username>`). If both `?r=` and `?u=` are present on initial deep-link or `popstate`, `?r=` wins and no user search is triggered. Deep-links, browser history, and page title follow `r/<subreddit>`.
- **Mode Separation:** The search switch controls `inputMode` only (toggling between user/subreddit search inputs). The active results view is strictly controlled by `resultsMode` (set only when a search is performed, on initial deep link, or on popstate). Toggling the switch never blanks or alters on-screen results or the URL.
- **Empty-Subreddit Guard:** Validates against `/^[A-Za-z0-9_]+$/` (ignoring optional `r/` prefix) in both `App.jsx` (before rendering `<SubredditMode>`) and `scanSubreddit` (before calling `fetchPage`). Empty/invalid subreddits immediately return an error with zero items and never hit the network.
- **Purpose:** Discovers and displays all deleted and mod-removed posts in a subreddit across multiple pages without requiring a username or keyword.
- **Scan Cap & Cursor:** Scans up to `maxPages` (default 5, 100 posts/page) or until `targetCount` (default 25) deleted/removed items are collected, with a 250ms throttle between pages. `nextCursor` is derived from the oldest `created_utc` seen on each raw page so pagination continues seamlessly without skipping posts. Users continue scanning with the "Keep scanning" button.
- **Safety Guard:** `scanSubreddit` strictly refuses to run unless a working author-block checker is supplied (`isBlockedAuthor` or both a non-empty `blockedHashes` array and `dynamicallyBlocked`); there is no permissive default.
- **Blocklist Rule (Fail-Closed & Request Batching):** Batched author check computes SHA-256 hashes per page and checks static `BLOCKED_HASHES` and dynamic `dynamicallyBlocked`. When both `isBlockedAuthor` and (`blockedHashes` + `dynamicallyBlocked`) are supplied, `blockedHashes` + `dynamicallyBlocked` takes precedence: static hashes are checked in memory first, and all dynamic checks fire in the same microtick, ensuring at most 1 dynamic blocklist request per page. Blocked authors' posts are silently dropped before counting (`scannedCount` and `foundCount` exclude them) with zero hints or placeholders. Items with author `"[deleted]"` have no username and are kept. If the dynamic blocklist cannot be reached (e.g. 503 or offline), the system fails closed and drops all real authors. Never reads or writes the profile cache and never offers tracking.
