import { useState, useMemo } from "react";
import {
    getPostMedia,
    getStatus,
    statusBorder,
    fmtNum,
    timeAgo,
    fullTimestamp,
    REDDIT_BASE,
} from "../lib/postMedia.js";

const BADGE = "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide leading-none";

function HoverTime({ utc }) {
    if (utc == null) return null;
    return (
        <span className="relative inline-block group/time">
            {timeAgo(utc)}
            <span className="pointer-events-none absolute top-full left-0 mt-1 z-50 whitespace-nowrap rounded border border-[#343536] bg-[#0d0d0d] px-2 py-1 text-[11px] text-[#d7dadc] opacity-0 group-hover/time:opacity-100 transition-opacity duration-75 shadow-lg shadow-black/40">
                {fullTimestamp(utc)}
            </span>
        </span>
    );
}

function StatusBadges({ item }) {
    const { removed, deleted } = getStatus(item, "posts");
    const dist = item.distinguished;
    if (!removed && !deleted && !item.over_18 && !item.spoiler && dist !== "admin" && dist !== "moderator") {
        return null;
    }
    return (
        <>
            {removed && <span className={`${BADGE} bg-[#3a1a1a] text-[#f4776b] border border-[#5a2626]`}>Removed</span>}
            {deleted && <span className={`${BADGE} bg-[#2c2620] text-[#d6a35c] border border-[#4a3d29]`}>Deleted</span>}
            {item.over_18 && <span className={`${BADGE} bg-[#3a1420] text-[#ff5c8a] border border-[#5a2038]`}>NSFW</span>}
            {item.spoiler && <span className={`${BADGE} bg-[#272729] text-[#a8a8a9] border border-[#3a3a3b]`}>Spoiler</span>}
            {dist === "admin" && <span className={`${BADGE} bg-[#3a1400] text-[#ff6a33] border border-[#5a2810]`}>Admin</span>}
            {dist === "moderator" && <span className={`${BADGE} bg-[#12312f] text-[#4fbdba] border border-[#1d4d4a]`}>Mod</span>}
        </>
    );
}

function MediaPlaceholder({ originalUrl }) {
    return (
        <div className="flex flex-col items-center justify-center py-10 px-4 text-center text-[#818384] select-none">
            <svg className="w-6 h-6 mb-1.5 opacity-50" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span className="text-xs font-medium text-[#a8a8a9]">Media unavailable</span>
            {originalUrl && (
                <a
                    href={originalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="mt-2 text-[11px] text-[#4fbdba] hover:underline transition-colors"
                >
                    Open original
                </a>
            )}
        </div>
    );
}

function GalleryViewer({ items = [], title = "", originalUrl = "" }) {
    const [idx, setIdx] = useState(0);
    const [failedSlideIds, setFailedSlideIds] = useState(() => new Set());

    const current = items[idx] || items[0];
    if (!current) return null;

    const isFailed = failedSlideIds.has(current.id || idx);

    const handleSlideError = () => {
        setFailedSlideIds((prev) => new Set(prev).add(current.id || idx));
    };

    return (
        <div className="relative w-full min-h-[220px] flex items-center justify-center">
            {isFailed ? (
                <MediaPlaceholder originalUrl={current.url || originalUrl} />
            ) : (
                <img
                    src={current.url}
                    alt={title || `Slide ${idx + 1}`}
                    loading="lazy"
                    decoding="async"
                    onClick={() => window.open(current.url, "_blank", "noopener,noreferrer")}
                    className="w-full max-h-[550px] object-contain cursor-zoom-in"
                    onError={handleSlideError}
                />
            )}

            {items.length > 1 && (
                <>
                    <div className="absolute top-3 right-3 px-2 py-0.5 rounded-full bg-black/60 backdrop-blur-sm text-[11px] font-medium text-white/90 select-none border border-white/10 pointer-events-none">
                        {idx + 1} / {items.length}
                    </div>
                    {idx > 0 && (
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                setIdx((i) => i - 1);
                            }}
                            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center transition-opacity border border-white/10 shadow cursor-pointer"
                            aria-label="Previous slide"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                            </svg>
                        </button>
                    )}
                    {idx < items.length - 1 && (
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                setIdx((i) => i + 1);
                            }}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center transition-opacity border border-white/10 shadow cursor-pointer"
                            aria-label="Next slide"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                            </svg>
                        </button>
                    )}
                </>
            )}
        </div>
    );
}

export function MediaPostCard({ post, duplicates = [] }) {
    const [mediaError, setMediaError] = useState(false);
    const status = getStatus(post, "posts");
    const media = getPostMedia(post);

    const postUrl = post.permalink
        ? `${REDDIT_BASE}${post.permalink}`
        : (post.url || "#");

    const subName = post.subreddit_name_prefixed || (post.subreddit ? `r/${post.subreddit}` : null);
    const subUrl = subName ? `${REDDIT_BASE}/${subName}` : null;

    const rawAuthor = post.author;
    const isDeletedAuthor = !rawAuthor || rawAuthor === "[deleted]" || rawAuthor === "[removed]";
    const authorText = isDeletedAuthor ? (rawAuthor || "[deleted]") : `u/${rawAuthor}`;
    const authorUrl = !isDeletedAuthor ? `${REDDIT_BASE}/user/${rawAuthor}` : null;

    const otherSubs = useMemo(() => {
        if (!duplicates || duplicates.length === 0) return [];
        return [
            ...new Set(
                duplicates
                    .map((d) => d.subreddit_name_prefixed || (d.subreddit ? `r/${d.subreddit}` : null))
                    .filter(Boolean)
            ),
        ];
    }, [duplicates]);

    return (
        <div className={`bg-[#1a1a1b] border ${statusBorder(status)} rounded overflow-hidden transition-all duration-150 hover:shadow-lg group p-3 sm:p-4`}>
            {/* 1. Header line: r/subreddit • username • relative time */}
            <div className="flex items-center gap-1.5 text-[11px] text-[#818384] mb-2 flex-wrap">
                {subName && (
                    <a
                        href={subUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="font-semibold text-[#d7dadc] hover:underline hover:text-white transition-colors"
                    >
                        {subName}
                    </a>
                )}
                {subName && authorText && <span>•</span>}
                {authorUrl ? (
                    <a
                        href={authorUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="hover:underline hover:text-[#d7dadc] transition-colors"
                    >
                        {authorText}
                    </a>
                ) : (
                    authorText && <span className="italic">{authorText}</span>
                )}
                {(subName || authorText) && post.created_utc != null && <span>•</span>}
                {post.created_utc != null && <HoverTime utc={post.created_utc} />}
                <StatusBadges item={post} />
                {post.link_flair_text && (
                    <>
                        <span>•</span>
                        <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-[#272729] text-[#d7dadc] border border-[#343536]">
                            {post.link_flair_text}
                        </span>
                    </>
                )}
                {otherSubs.length > 0 && (
                    <>
                        <span>•</span>
                        <span className="text-[#818384]">
                            also in{" "}
                            {otherSubs.map((sub, idx) => (
                                <span key={sub}>
                                    {idx > 0 && ", "}
                                    <a
                                        href={`${REDDIT_BASE}/${sub}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        onClick={(e) => e.stopPropagation()}
                                        className="hover:text-[#fe5301] transition-colors"
                                    >
                                        {sub}
                                    </a>
                                </span>
                            ))}
                        </span>
                    </>
                )}
            </div>

            {/* 2. Title */}
            <h2 className="text-[15px] sm:text-base font-normal text-[#d7dadc] leading-snug mb-3 break-words group-hover:text-white transition-colors">
                <a
                    href={postUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:underline"
                >
                    {post.title}
                </a>
            </h2>

            {/* 3. Media: full card width, rounded corners (about 16px), keeping aspect ratio */}
            {media && (
                <div className="w-full min-h-[220px] rounded-[16px] overflow-hidden bg-[#111112] border border-[#272729] mb-3 flex items-center justify-center relative">
                    {media.type === "image" && (
                        mediaError ? (
                            <MediaPlaceholder originalUrl={media.originalUrl || media.url} />
                        ) : (
                            <img
                                src={media.url}
                                alt={post.title || ""}
                                loading="lazy"
                                decoding="async"
                                onClick={() => window.open(media.url, "_blank", "noopener,noreferrer")}
                                className="w-full max-h-[550px] object-contain cursor-zoom-in"
                                onError={() => setMediaError(true)}
                            />
                        )
                    )}
                    {media.type === "gallery" && (
                        <GalleryViewer
                            items={media.items}
                            title={post.title}
                            originalUrl={media.originalUrl}
                        />
                    )}
                    {media.type === "video" && (
                        mediaError ? (
                            <MediaPlaceholder originalUrl={media.originalUrl || media.url} />
                        ) : (
                            <video
                                src={media.url}
                                poster={media.poster}
                                controls
                                playsInline
                                preload="none"
                                className="w-full max-h-[550px] object-contain bg-black"
                                onError={() => setMediaError(true)}
                            />
                        )
                    )}
                </div>
            )}

            {/* 4. Bottom action row with display-only vote and comment pills */}
            <div className="flex items-center gap-2 select-none">
                {/* Vote pill */}
                <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#2a140a] border border-[#ff4500]/40 text-[#ff4500] text-xs font-semibold">
                    <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                    </svg>
                    <span>{fmtNum(post.score ?? 0)}</span>
                    <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7-7 7-7" />
                    </svg>
                </div>

                {/* Comment pill */}
                <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#242426] border border-[#343536] text-[#d7dadc] text-xs font-medium">
                    <svg className="w-3.5 h-3.5 text-[#818384] flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                    <span>{fmtNum(post.num_comments ?? 0)}</span>
                </div>
            </div>
        </div>
    );
}
