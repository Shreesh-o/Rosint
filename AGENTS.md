# Rosint (redditOSINT) — Project Guide

## Overview
Rosint is a client-side Reddit intelligence tool that queries independent public archives (Arctic Shift and PullPush) directly from the browser. It merges and deduplicates post and comment histories, revealing deleted posts and mod-removed comments without requiring Reddit API keys or credentials. It also includes an opt-out restriction system (static SHA-256 hashes + dynamic removal service API) and operator CLI scripts.

## Verified Commands
- **Runtime:** Node.js ≥ 24 (`v26.13.1` verified)
- **Install:** `npm ci` (configured with `.npmrc` `legacy-peer-deps=true`)
- **Dev Server:** `npm run dev` (starts Vite on `http://localhost:5173`)
- **Test:** `npm test` (`node --test tests/*.test.mjs` — 54 unit tests)
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
│   ├── blocklist.js         # Removal service client (createBlocklistClient) with 30s in-memory cache & fail-closed fallback
│   ├── normalizeUsername.js # Cleans usernames (strips u/, URLs, @, slashes); shared by UI and CLI scripts
│   ├── postLookup.js        # Batched & cached post ID queries (createPostLookup) and retry logic (fetchWithBackoff)
│   ├── components/
│   │   ├── TrackedUsers.jsx # TrackedUsers list & TrackToggle button components
│   │   ├── ProfileCache.jsx # CacheBanner & ClearCacheButton components
│   │   └── DedupeToggle.jsx # DedupeToggle component for duplicate post filtering
│   ├── lib/
│   │   ├── trackedUsers.js  # Tracked users helpers (loadTracked, saveTracked, addUser, removeUser)
│   │   ├── profileCache.js  # Stale-while-revalidate IndexedDB cache with LRU eviction and merge logic
│   │   └── dedupePosts.js   # Pure helper for post URL/media extraction and duplicate grouping
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
│   └── dedupe-posts.test.mjs   # Unit tests for duplicate post URL normalization and grouping
├── vite-plugin-tracked-users.js # Dev-only Vite plugin serving /api/tracked backed by data/tracked-users.json
├── vite.config.js           # Vite config with React plugin, tracked users plugin, and proxy /api -> http://127.0.0.1:8787
├── wrangler.jsonc           # Cloudflare Worker configuration (routing, assets, services binding)
└── .env.example             # Optional env config (GEMINI_API_KEY, VITE_REMOVAL_SERVICE_ORIGIN)
```

## Data Flow
1. **User input:** Username entered or read from `?u=<user>` query param.
2. **Normalization:** `normalizeUsername()` strips prefixes and URLs.
3. **Restriction check:** `isBlockedUser()` computes SHA-256 hash, checks static `BLOCKED_HASHES` in `App.jsx`, then calls `dynamicallyBlocked()` in `blocklist.js`. If blocked, `runDecoySearch()` triggers a fake 1–3s delay and returns empty results without querying archives.
4. **Archive fetch:** `fetchBoth()` executes parallel browser `fetch()` requests to Arctic Shift and PullPush via `safeFetch()` / `fetchWithBackoff()`.
5. **Merge & deduplicate:** Items merged by ID, filtered client-side (NSFW, deleted-only), and sorted by `created_utc`.
6. **Parent hydration:** Comment cards use `lookupPost()` (`postLookup.js`) to batch-fetch parent post metadata (up to 500 IDs per request).

## Coding Conventions
- **Language:** Plain JavaScript / JSX (React 19). No TypeScript.
- **Styling:** Inline Tailwind CSS classes. Keyframe animations defined in `<style>` tag in `App.jsx`.
- **Testability:** Injectable I/O dependencies pattern across modules (`fetcher`, `wait`, `schedule`, `now`, `random`). Avoid global mocks.
- **Error handling:** Fail-soft for public archives (`safeFetch` returns `{ data: [], ok: false }`); fail-closed for removal checks (`blocklist.js` returns `true` on error).

## Step-by-Step: Adding a New Search Filter
1. **State:** Add a new `useState` in `App()` in `src/App.jsx`.
2. **Filter definition:** Include parameter in `buildFilters()` in `src/App.jsx`.
3. **URL / Client filter:**
   - If archive supports server-side filtering, append query param in `buildUrls()`.
   - If not supported server-side, add array filter step in `fetchBoth()`.
4. **UI:** Add corresponding control to both the landing `Advanced filters` section and the results `Filters` drawer.
5. **Reset:** Update `clearFilters()` to reset state to default.

## Gotchas & Fragile Areas
- **`App.jsx` Monolith:** Contains over 2,700 lines. The static array `const BLOCKED_HASHES = [...]` must retain its exact marker syntax because `scripts/block.mjs` parses and rewrites it via string matching.
- **Privacy / Decoy Invariant:** Never fire archive API queries when a search returns empty for a blocked user. Keep `UserSummary` gated behind `!searchBlocked`.
- **Client-Side Sorting:** Sort order (Newest, Oldest, Top) only re-sorts the current page (≤100 items), not the complete archive dataset.
- **Pagination Cursor:** Pagination uses timestamp cursors (`before=` / `after=`). Changing sort order does not fetch new paginated slices.
- **Unused Dependencies:** `@neon/config` and `@neon/env` are declared in `package.json` but unreferenced in code.
- **ESLint Warning:** `TotalActivityChart` has an intentional missing dependency warning (`hours`) in its `useEffect`.

## Verification Checklist
Before submitting changes:
- [ ] `npm test` passes all 54 tests.
- [ ] `npm run lint` reports 0 errors (1 warning in `App.jsx` is baseline).
- [ ] `npm run build` finishes without errors.
- [ ] Launch `npm run dev` and test:
  - Standard search: `http://localhost:5173/?u=spez`
  - Comment tree expansion and parent post cards
  - Date and keyword filters
  - Maintenance screen: `http://localhost:5173/?dino`

## Tracked Users Feature
- **Files Involved:**
  - `src/components/TrackedUsers.jsx`: `TrackedUsers` compact chip list and `TrackToggle` profile toggle button.
  - `src/lib/trackedUsers.js`: Pure helpers (`isValidTrackedData`, `isValidTrackedUser`, `addTrackedUser`, `removeTrackedUser`) and async endpoint methods (`loadTracked`, `saveTracked`, `addUser`, `removeUser`).
  - `vite-plugin-tracked-users.js`: Dev-only Connect middleware (`apply: 'serve'`) exposing `GET /api/tracked` and atomic `PUT /api/tracked`.
  - `data/tracked-users.json`: Storage file on disk (ignored in `.gitignore`).
  - `tests/tracked-users.test.mjs`: Unit tests for data validation, normalization, persistence, and legacy format compatibility.
- **Dev-Only Endpoint:**
  - `GET /api/tracked`: Returns JSON file contents or `{"users":[]}` if the file does not exist. Returns 500 on malformed file.
  - `PUT /api/tracked`: Validates payload against `isValidTrackedData`, writes via temp file and atomic POSIX rename to avoid partial writes.
  - In production / preview builds, `/api/tracked` is absent. `loadTracked()` returns `null`, causing the feature UI to hide completely and safely.
- **Data Shape:**
  ```json
  {
    "users": [
      {
        "username": "spez",
        "addedAt": 1700000000
      }
    ]
  }
  ```
  *(Validation also accepts and ignores legacy fields like `lastCheckedAt`, `newPosts`, and `newComments` for backwards compatibility).*
- **Interaction & Navigation:**
  - Clicking a tracked chip triggers `onSelectUser(u.username)`, reusing the app's existing `searchUser` path and URL query parameter (`?u=`).
  - `TrackToggle` next to profile header allows tracking/untracking the current user, updating local state and `/api/tracked` storage.
- **Privacy Invariant:**
  - Blocked users must never be distinguishable from non-existent or empty users.
  - `TrackToggle` is hidden whenever `searchBlocked` is true.
  - Clicking a tracked user who is blocked triggers normal search, which runs the decoy delay without querying archives.

## Profile Cache (Stale-While-Revalidate)
- **Files Involved:**
  - `src/lib/profileCache.js`: Core IndexedDB cache manager (`rosint_cache`, store `profiles`), LRU eviction (~1.5 GB cap + `navigator.storage.estimate()` respect), item merging by `id`, and `loadProfileWithCache`.
  - `src/components/ProfileCache.jsx`: `CacheBanner` (`Cached · updated X ago · Refreshing…` + `Refresh` button) and `ClearCacheButton` footer link.
  - `tests/profile-cache.test.mjs`: Tests for key normalization, merging by id, LRU eviction, quota estimation, and privacy invariant.
- **Privacy Invariant:**
  - Blocklist check (`isBlockedUser`) executes BEFORE any cache read.
  - If a user is blocked, `deleteCachedProfile` deletes any cached profile entry, and decoy search runs without cache read or write.

## Duplicate Posts Filter
- **Files Involved:**
  - `src/lib/dedupePosts.js`: Target URL and media key normalizer (`extractPostMediaKey`), grouping logic keeping newest post visible (`groupDuplicates`).
  - `src/components/DedupeToggle.jsx`: Toggle checkbox with count indicator, persisted in `localStorage` under `rosint:hide-duplicates`.
  - `tests/dedupe-posts.test.mjs`: Tests for tracking parameter stripping, media id equivalences (`i.redd.it` vs `preview.redd.it`), self/permalink exclusion, and newest-kept grouping.
- **Privacy Invariant:**
  - Purely client-side on loaded post array; zero network requests and never rendered for blocked/decoy searches.
