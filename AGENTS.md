# Rosint (redditOSINT) — Project Guide

## Overview
Rosint is a client-side Reddit intelligence tool that queries independent public archives (Arctic Shift and PullPush) directly from the browser. It merges and deduplicates post and comment histories, revealing deleted posts and mod-removed comments without requiring Reddit API keys or credentials. It includes an opt-out restriction system (static SHA-256 hashes + dynamic removal service API) and operator CLI scripts.

## Verified Commands
- **Runtime:** Node.js ≥ 24 (`v26.13.1` verified)
- **Install:** `npm ci` (configured with `.npmrc` `legacy-peer-deps=true`)
- **Dev Server:** `npm run dev` (starts Vite on `http://localhost:5173`)
- **Test:** `npm test` (`node --test tests/*.test.mjs` — 63 unit tests)
- **Lint:** `npm run lint` (`eslint .` — 0 errors, 1 known warning)
- **Build:** `npm run build` (Vite production build to `dist/`)
- **Preview:** `npm run preview` (previews `dist/`)
- **Worker Check:** `npm run deploy:check` (`wrangler deploy --dry-run`)

## Architecture & Directory Map
```
Rosint/
├── src/
│   ├── main.jsx             # React DOM entry point, Vercel analytics, canonical domain redirect
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
- **Shared Helpers & Duplication:** Formatting helpers (`timeAgo`, `fullTimestamp`, `fmtNum`, `getStatus`, `statusBorder`) now live in `src/lib/postMedia.js` and are imported by `App.jsx` to prevent duplication while keeping `App.jsx` exporting only components (preserving Vite Fast Refresh). The duplication of ARCTIC/PULLPUSH URLs and `safeFetch` with `scripts/lib/archive.mjs`, and unused `@neon/*` dependencies, remain known debt.
- **Client-Side Sorting & Pagination:** Sorting (Newest, Oldest, Top) re-sorts the current page (≤100 items), not the complete archive dataset. Pagination uses timestamp cursors (`before=` / `after=`).

## Verification Checklist
Before submitting changes:
- [ ] `npm test` passes all 63 tests.
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
- **Key Functions:** `hasMedia`, `getPostMedia`, `cleanMediaUrl`, `fmtNum`, `timeAgo`, `getStatus`, `statusBorder`.
- **Privacy Rule:** Pure presentation formatting on already loaded posts. Zero network queries; never rendered for blocked/decoy searches.

### 4. Tracked Users
- **Files:** `src/lib/trackedUsers.js`, `src/components/TrackedUsers.jsx`, `vite-plugin-tracked-users.js`, `tests/tracked-users.test.mjs`
- **Purpose:** Local dev-only tracking list stored in `data/tracked-users.json` via dev-server API (`/api/tracked`). Automatically hidden in production builds.
- **Privacy Rule:** Blocked users trigger normal decoy search delay without querying archives; `TrackToggle` is hidden on blocked searches.
