import { useState, useEffect, useRef, useCallback, useMemo, Component } from "react";
import { scanSubreddit } from "../lib/subredditScan.js";
import { hasMedia } from "../lib/postMedia.js";
import { MediaPostCard } from "./MediaPostCard.jsx";
import { DedupeToggle } from "./DedupeToggle.jsx";
import { groupDuplicates } from "../lib/dedupePosts.js";

// ─── Error Boundary for Post Cards ───────────────────────────────────────────
class CardBoundary extends Component {
    state = { failed: false };
    static getDerivedStateFromError() { return { failed: true }; }
    componentDidCatch() { /* swallow — bad record fallback */ }
    render() {
        if (this.state.failed) {
            return (
                <div className="bg-[#1a1a1b] border border-[#343536] rounded px-3 py-2.5 text-[12px] text-[#818384] italic">
                    This item couldn't be displayed.
                </div>
            );
        }
        return this.props.children;
    }
}

const IconSpinner = () => (
    <svg className="w-4 h-4 animate-spin text-[#ff4500]" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
);

export function SubredditMode({
    subreddit,
    blockedHashes,
    dynamicallyBlocked,
    isBlockedAuthor,
    PostCard,
}) {
    const [items, setItems] = useState([]);
    const [scannedCount, setScannedCount] = useState(0);
    const [nextCursor, setNextCursor] = useState(null);
    const [exhausted, setExhausted] = useState(false);
    const [scanning, setScanning] = useState(false);
    const [error, setError] = useState(null);

    // Filters
    const [dateFrom, setDateFrom] = useState("");
    const [dateTo, setDateTo] = useState("");
    const [nsfwOnly, setNsfwOnly] = useState(false);
    const [keywords, setKeywords] = useState("");
    const [showFilters, setShowFilters] = useState(false);

    // View options
    const [sortOrder, setSortOrder] = useState("desc");
    const [hideDuplicates, setHideDuplicates] = useState(() => {
        try {
            const saved = localStorage.getItem("rosint:hide-duplicates");
            return saved === null ? true : saved === "true";
        } catch {
            return true;
        }
    });

    const handleToggleDedupe = useCallback((val) => {
        setHideDuplicates(val);
        try {
            localStorage.setItem("rosint:hide-duplicates", String(val));
        } catch {
            // Ignore storage errors
        }
    }, []);

    // Race-condition guard: ignore outdated scan responses
    const seqRef = useRef(0);

    const executeScan = useCallback(async ({ reset = false, cursor = null } = {}) => {
        const clean = typeof subreddit === "string" ? subreddit.trim().replace(/^r\//i, "").trim() : "";
        if (!clean || !/^[A-Za-z0-9_]+$/.test(clean)) return;
        const seq = ++seqRef.current;
        setScanning(true);
        setError(null);

        if (reset) {
            setItems([]);
            setScannedCount(0);
            setNextCursor(null);
            setExhausted(false);
        }

        const filterObj = {};
        if (dateFrom) filterObj.dateFrom = Math.floor(new Date(dateFrom).getTime() / 1000);
        if (dateTo) filterObj.dateTo = Math.floor(new Date(dateTo).getTime() / 1000);
        if (nsfwOnly) filterObj.over18 = true;
        if (keywords.trim()) filterObj.keywords = keywords.trim();

        try {
            const res = await scanSubreddit({
                subreddit,
                filters: filterObj,
                cursor,
                maxPages: 5,
                targetCount: 25,
                blockedHashes,
                dynamicallyBlocked,
                isBlockedAuthor,
            });

            if (seq !== seqRef.current) return;

            if (res.errors && res.errors.length > 0) {
                setError(res.errors[0]);
            }

            setItems((prev) => {
                if (reset || !cursor) return res.items;
                const seen = new Set(prev.map((p) => p.id));
                const fresh = res.items.filter((p) => p?.id && !seen.has(p.id));
                return [...prev, ...fresh];
            });

            setScannedCount((prev) => (reset || !cursor ? res.scannedCount : prev + res.scannedCount));
            setNextCursor(res.nextCursor);
            setExhausted(res.exhausted);
        } catch (err) {
            if (seq !== seqRef.current) return;
            setError(err.message || "Failed to scan subreddit");
        } finally {
            if (seq === seqRef.current) {
                setScanning(false);
            }
        }
    }, [subreddit, dateFrom, dateTo, nsfwOnly, keywords, blockedHashes, dynamicallyBlocked, isBlockedAuthor]);

    // Initial scan on subreddit change
    useEffect(() => {
        executeScan({ reset: true, cursor: null });
    }, [subreddit, executeScan]);

    const handleApplyFilters = (e) => {
        e?.preventDefault();
        executeScan({ reset: true, cursor: null });
    };

    const handleClearFilters = () => {
        setDateFrom("");
        setDateTo("");
        setNsfwOnly(false);
        setKeywords("");
        // Will re-scan on next tick after states clear
        setTimeout(() => executeScan({ reset: true, cursor: null }), 0);
    };

    const handleKeepScanning = () => {
        if (scanning || exhausted || !nextCursor) return;
        executeScan({ reset: false, cursor: nextCursor });
    };

    // Deduplication
    const { visible: deduplicatedPosts, hiddenCount, groups: duplicateGroups } = useMemo(() => {
        return hideDuplicates ? groupDuplicates(items) : { visible: items, hiddenCount: 0, groups: {} };
    }, [items, hideDuplicates]);

    // Sorting
    const sortedPosts = useMemo(() => {
        const list = [...deduplicatedPosts];
        if (sortOrder === "desc") {
            list.sort((a, b) => (b.created_utc || 0) - (a.created_utc || 0));
        } else if (sortOrder === "asc") {
            list.sort((a, b) => (a.created_utc || 0) - (b.created_utc || 0));
        } else if (sortOrder === "top") {
            list.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
        }
        return list;
    }, [deduplicatedPosts, sortOrder]);

    const hasActiveFilters = Boolean(dateFrom || dateTo || nsfwOnly || keywords.trim());

    return (
        <div className="max-w-3xl mx-auto px-4 mt-6 pb-16">
            {/* ── Subreddit Header ── */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[#222]">
                <div>
                    <h1 className="text-xl font-bold text-white flex items-center gap-2">
                        r/{subreddit}
                        <span className="text-xs font-normal text-[#818384] bg-[#1a1a1b] border border-[#343536] px-2 py-0.5 rounded">
                            Deleted &amp; Removed
                        </span>
                    </h1>
                    <p className="text-[12px] text-[#818384] mt-1">
                        Scanned {scannedCount.toLocaleString()} posts · found {items.length.toLocaleString()} deleted/removed
                        {scanning && (
                            <span className="inline-flex items-center gap-1.5 ml-2 text-[#ff4500]">
                                <IconSpinner /> Scanning archive…
                            </span>
                        )}
                    </p>
                </div>

                <div className="flex items-center gap-2 self-start sm:self-auto">
                    <button
                        type="button"
                        onClick={() => setShowFilters((f) => !f)}
                        className={`flex items-center gap-1 px-2.5 py-1 text-xs rounded border transition-colors ${
                            hasActiveFilters
                                ? "border-[#ff4500] text-[#ff4500] bg-[#ff4500]/10"
                                : "border-[#343536] text-[#818384] hover:text-[#d7dadc] hover:border-[#818384]"
                        }`}
                    >
                        Filters {hasActiveFilters && "•"}
                        <svg aria-hidden="true" className={`w-3 h-3 transition-transform duration-200 ${showFilters ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                    </button>
                </div>
            </div>

            {/* ── Expandable Filter Panel ── */}
            {showFilters && (
                <form onSubmit={handleApplyFilters} className="bg-[#141415] border border-[#272729] rounded-lg p-3.5 my-4 flex flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-3">
                        <div className="flex items-center gap-2">
                            <span className="text-[11px] text-[#818384]">From:</span>
                            <input
                                type="date"
                                value={dateFrom}
                                onChange={(e) => setDateFrom(e.target.value)}
                                className="bg-[#1a1a1b] border border-[#343536] rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-[#ff4500]"
                            />
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-[11px] text-[#818384]">To:</span>
                            <input
                                type="date"
                                value={dateTo}
                                onChange={(e) => setDateTo(e.target.value)}
                                className="bg-[#1a1a1b] border border-[#343536] rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-[#ff4500]"
                            />
                        </div>
                        <div className="flex items-center gap-2 flex-1 min-w-[160px]">
                            <input
                                type="text"
                                placeholder="Keywords in title or body…"
                                value={keywords}
                                onChange={(e) => setKeywords(e.target.value)}
                                className="w-full bg-[#1a1a1b] border border-[#343536] rounded px-2.5 py-1 text-xs text-white placeholder-[#818384] focus:outline-none focus:border-[#ff4500]"
                            />
                        </div>
                    </div>

                    <div className="flex items-center justify-between gap-3 pt-1 border-t border-[#222]">
                        <label className="flex items-center gap-1.5 cursor-pointer select-none text-xs text-[#818384] hover:text-[#d7dadc]">
                            <input
                                type="checkbox"
                                checked={nsfwOnly}
                                onChange={(e) => setNsfwOnly(e.target.checked)}
                                className="w-3.5 h-3.5 accent-[#ff4500] cursor-pointer"
                            />
                            <span>NSFW only</span>
                        </label>

                        <div className="flex items-center gap-2">
                            <button
                                type="submit"
                                disabled={scanning}
                                className="px-3 py-1 text-xs font-medium text-white bg-[#ff4500] hover:bg-[#e03d00] disabled:opacity-50 rounded transition-colors"
                            >
                                Apply Filters
                            </button>
                            {hasActiveFilters && (
                                <button
                                    type="button"
                                    onClick={handleClearFilters}
                                    disabled={scanning}
                                    className="px-2.5 py-1 text-xs text-[#818384] hover:text-white border border-[#343536] hover:border-[#818384] disabled:opacity-50 rounded transition-colors"
                                >
                                    Clear
                                </button>
                            )}
                        </div>
                    </div>
                </form>
            )}

            {/* ── Toolbar: Dedupe & Sort ── */}
            <div className="flex items-center justify-between gap-2 py-3">
                <DedupeToggle
                    hideDuplicates={hideDuplicates}
                    onToggle={handleToggleDedupe}
                    hiddenCount={hiddenCount}
                />

                <div className="flex items-center gap-2">
                    <span className="text-[11px] text-[#818384]">Sort:</span>
                    <select
                        aria-label="Sort order"
                        value={sortOrder}
                        onChange={(e) => setSortOrder(e.target.value)}
                        className="text-[11px] text-[#818384] bg-[#1a1a1b] border border-[#343536] hover:border-[#818384] rounded px-2 py-1 transition-colors focus:outline-none focus:border-[#ff4500] cursor-pointer"
                    >
                        <option value="desc">Newest</option>
                        <option value="asc">Oldest</option>
                        <option value="top">Top score</option>
                    </select>
                </div>
            </div>

            {/* ── Inline Error Message (keeps earlier results) ── */}
            {error && (
                <div className="mb-4 px-3.5 py-2.5 rounded bg-[#2a1717] border border-[#522525] text-red-300 text-xs flex items-center justify-between gap-2">
                    <span>{error}</span>
                    <button
                        type="button"
                        onClick={() => executeScan({ reset: false, cursor: nextCursor })}
                        className="text-white underline hover:no-underline font-medium text-[11px]"
                    >
                        Keep scanning
                    </button>
                </div>
            )}

            {/* ── Results Feed ── */}
            {sortedPosts.length > 0 ? (
                <div className="flex flex-col gap-2">
                    {sortedPosts.map((item) => (
                        <CardBoundary key={item.id}>
                            {hasMedia(item) ? (
                                <MediaPostCard post={item} duplicates={duplicateGroups[item.id]} />
                            ) : (
                                <PostCard post={item} duplicates={duplicateGroups[item.id]} />
                            )}
                        </CardBoundary>
                    ))}
                </div>
            ) : !scanning && !error && (
                <div className="text-center py-16 px-4 bg-[#141415] border border-[#222] rounded-lg mt-2">
                    <p className="text-white font-medium text-sm">
                        No deleted or removed posts found in the scanned range.
                    </p>
                    <p className="text-[#818384] text-xs mt-1">
                        Try scanning further back or adjusting your date and keyword filters.
                    </p>
                </div>
            )}

            {/* ── Bottom Actions: Keep Scanning & Exhausted Notice ── */}
            <div className="mt-6 flex flex-col items-center gap-2">
                {exhausted ? (
                    <div className="text-xs text-[#818384] py-2 px-4 rounded bg-[#1a1a1b] border border-[#272729]">
                        No more posts available
                    </div>
                ) : (
                    nextCursor && (
                        <button
                            type="button"
                            onClick={handleKeepScanning}
                            disabled={scanning}
                            className="flex items-center gap-2 px-5 py-2 rounded-md bg-[#1a1a1b] hover:bg-[#252526] border border-[#343536] hover:border-[#ff4500] text-sm text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                        >
                            {scanning ? (
                                <>
                                    <IconSpinner />
                                    <span>Scanning next batch…</span>
                                </>
                            ) : (
                                <span>Keep scanning</span>
                            )}
                        </button>
                    )
                )}
            </div>
        </div>
    );
}
