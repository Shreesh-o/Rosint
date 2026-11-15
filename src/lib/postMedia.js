/**
 * Pure helpers for detecting, extracting, and cleaning media from Reddit posts,
 * along with formatting utilities shared between post card views.
 * Distinguishes media posts (images, galleries, videos, gifs) from
 * non-media posts (text posts and plain external link posts).
 */

export const REDDIT_BASE = "https://www.reddit.com";

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "gifv"]);

/**
 * Decodes HTML entities in URLs (e.g. &amp; -> &) and trims whitespace.
 *
 * @param {string} raw
 * @returns {string}
 */
export function cleanMediaUrl(raw) {
    if (!raw || typeof raw !== "string") return "";
    return raw
        .replace(/&amp;/g, "&")
        .replace(/&#38;/g, "&")
        .replace(/&quot;/g, '"')
        .trim();
}

export function fmtNum(n) {
    if (n == null) return "0";
    if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return String(n);
}

export function timeAgo(utc) {
    if (utc == null) return "";
    const s = Math.floor(Date.now() / 1000 - utc);
    if (s < 60) return `${Math.max(0, s)}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 365) return `${d}d ago`;
    return `${Math.floor(d / 365)}y ago`;
}

export function fullTimestamp(utc) {
    if (utc == null) return "";
    return new Date(utc * 1000).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "long",
    });
}

export function getStatus(item, type = "posts") {
    if (!item || typeof item !== "object") return { removed: false, deleted: false };
    const text = type === "posts" ? item.selftext : item.body;
    return {
        removed: text === "[removed]" || (type === "posts" && Boolean(item.removed_by_category)),
        deleted: text === "[deleted]" || item.author === "[deleted]",
    };
}

export function statusBorderBase({ removed, deleted }) {
    if (removed) return "border-[#4a2626]";
    if (deleted) return "border-[#41371f]";
    return "border-[#343536]";
}

export function statusBorderHover({ removed, deleted }) {
    if (removed) return "hover:border-[#6e3838]";
    if (deleted) return "hover:border-[#5f4f28]";
    return "hover:border-[#818384]";
}

export function statusBorder(status) {
    if (!status) return "border-[#343536] hover:border-[#818384]";
    return `${statusBorderBase(status)} ${statusBorderHover(status)}`;
}

function getExtension(url) {
    if (!url || typeof url !== "string") return "";
    try {
        const pathname = new URL(url).pathname;
        const last = pathname.split("/").filter(Boolean).pop() || "";
        const parts = last.split(".");
        return parts.length > 1 ? parts.pop().toLowerCase() : "";
    } catch {
        const clean = url.split("?")[0].split("#")[0];
        const parts = clean.split("/").pop().split(".");
        return parts.length > 1 ? parts.pop().toLowerCase() : "";
    }
}

/**
 * Extracts structured media info from a post.
 * Returns null for text posts and plain link posts without media.
 * Prefers full-size source over lower-resolution previews.
 *
 * @param {object} post
 * @returns {{ type: 'image' | 'gallery' | 'video', url?: string, items?: Array<{ url: string, id: string }>, poster?: string, originalUrl?: string } | null}
 */
export function getPostMedia(post) {
    if (!post || typeof post !== "object") return null;

    // Self posts are text posts unless they have explicit gallery / media metadata
    const isSelf = post.is_self || (typeof post.domain === "string" && post.domain.toLowerCase().startsWith("self."));

    const rawUrl = post.url_overridden_by_dest || post.url || "";
    const originalUrl = cleanMediaUrl(rawUrl || (post.permalink ? `${REDDIT_BASE}${post.permalink}` : ""));

    // 1. Galleries
    const hasGalleryData = Array.isArray(post.gallery_data?.items) && post.gallery_data.items.length > 0;
    const hasMediaMetadata = post.media_metadata && typeof post.media_metadata === "object" && Object.keys(post.media_metadata).length > 0;

    if (post.is_gallery || (hasGalleryData && hasMediaMetadata)) {
        const items = [];
        if (hasGalleryData) {
            for (const item of post.gallery_data.items) {
                const meta = post.media_metadata?.[item.media_id];
                // Prefer full-size source (meta.s) over low-res preview (meta.p)
                const sourceUrl = meta?.s?.u || meta?.s?.gif || meta?.s?.mp4;
                const fallbackUrl = meta?.p?.[meta.p.length - 1]?.u;
                const chosen = sourceUrl || fallbackUrl;
                if (chosen) {
                    items.push({
                        id: item.media_id,
                        url: cleanMediaUrl(chosen),
                    });
                }
            }
        } else if (hasMediaMetadata) {
            for (const [id, meta] of Object.entries(post.media_metadata)) {
                const sourceUrl = meta?.s?.u || meta?.s?.gif || meta?.s?.mp4;
                const fallbackUrl = meta?.p?.[meta.p.length - 1]?.u;
                const chosen = sourceUrl || fallbackUrl;
                if (chosen) {
                    items.push({
                        id,
                        url: cleanMediaUrl(chosen),
                    });
                }
            }
        }
        if (items.length > 0) {
            return { type: "gallery", items, originalUrl };
        }
    }

    // If it's a self text post with no gallery, it's a text post (no media)
    if (isSelf) return null;

    const ext = getExtension(rawUrl);
    const domain = (post.domain || "").toLowerCase();

    // 2. Reddit Video
    if (
        post.is_video ||
        post.media?.reddit_video?.fallback_url ||
        post.secure_media?.reddit_video?.fallback_url ||
        domain === "v.redd.it"
    ) {
        const videoUrl =
            post.media?.reddit_video?.fallback_url ||
            post.secure_media?.reddit_video?.fallback_url ||
            post.preview?.reddit_video_preview?.fallback_url ||
            (domain === "v.redd.it" ? rawUrl : null);

        if (videoUrl) {
            // Full-size preview source for video poster
            const poster = cleanMediaUrl(post.preview?.images?.[0]?.source?.url);
            return {
                type: "video",
                url: cleanMediaUrl(videoUrl),
                poster: poster || undefined,
                originalUrl,
            };
        }
    }

    // 3. External Video / GIF (gfycat, redgifs, imgur gifv/mp4, preview video)
    if (post.preview?.reddit_video_preview?.fallback_url) {
        return {
            type: "video",
            url: cleanMediaUrl(post.preview.reddit_video_preview.fallback_url),
            poster: cleanMediaUrl(post.preview?.images?.[0]?.source?.url) || undefined,
            originalUrl,
        };
    }

    if (VIDEO_EXTENSIONS.has(ext)) {
        return {
            type: "video",
            url: cleanMediaUrl(ext === "gifv" ? rawUrl.replace(/\.gifv$/i, ".mp4") : rawUrl),
            poster: cleanMediaUrl(post.preview?.images?.[0]?.source?.url) || undefined,
            originalUrl,
        };
    }

    if (domain === "gfycat.com" || domain.endsWith(".gfycat.com") || domain === "redgifs.com" || domain.endsWith(".redgifs.com")) {
        const previewVideo = post.preview?.reddit_video_preview?.fallback_url;
        if (previewVideo) {
            return { type: "video", url: cleanMediaUrl(previewVideo), originalUrl };
        }
        const poster = cleanMediaUrl(post.preview?.images?.[0]?.source?.url);
        if (poster) {
            return { type: "image", url: poster, originalUrl };
        }
    }

    // 4. Image Posts: prefer full-size direct upload or preview source over resolutions
    if (
        domain === "i.redd.it" ||
        domain === "preview.redd.it" ||
        IMAGE_EXTENSIONS.has(ext) ||
        post.post_hint === "image"
    ) {
        // Direct uncompressed image URL takes precedence
        const isDirect = IMAGE_EXTENSIONS.has(ext) || domain === "i.redd.it" || domain === "preview.redd.it";
        const directUrl = isDirect ? rawUrl : null;
        // Full-size source from preview
        const previewSource = post.preview?.images?.[0]?.source?.url;
        // Full-size source from metadata
        const metaSource = post.media_metadata ? Object.values(post.media_metadata)[0]?.s?.u : null;
        const finalUrl = directUrl || previewSource || metaSource;

        if (finalUrl) {
            return { type: "image", url: cleanMediaUrl(finalUrl), originalUrl };
        }
    }

    // Plain link post (e.g. news article, external webpage, etc.)
    return null;
}

/**
 * Returns true if the post has media (image, gallery, video, gif),
 * false for text posts and plain link posts.
 *
 * @param {object} post
 * @returns {boolean}
 */
export function hasMedia(post) {
    return getPostMedia(post) !== null;
}

// ─── Removed Image Placeholder & Recovery ─────────────────────────────────────

// Known dimensions of removed-image placeholder graphics served by image hosts.
// New dimensions can be appended here as they are discovered.
export const KNOWN_REMOVED_PLACEHOLDER_SIZES = Object.freeze([
    { width: 161, height: 81 },
    { width: 130, height: 60 },
]);

export const REMOVED_PLACEHOLDER_ALLOWED_HOSTS = new Set([
    "i.redd.it",
    "preview.redd.it",
    "external-preview.redd.it",
]);

/**
 * Checks if a URL points to an allowed image host for placeholder detection:
 * imgur.com and its subdomains, i.redd.it, preview.redd.it, external-preview.redd.it.
 *
 * @param {string} url
 * @returns {boolean}
 */
export function isAllowedPlaceholderHost(url) {
    if (!url || typeof url !== "string") return false;
    try {
        const target = url.startsWith("//") ? `https:${url}` : url;
        const parsed = new URL(target);
        const host = parsed.hostname.toLowerCase();
        if (host === "imgur.com" || host.endsWith(".imgur.com")) return true;
        if (REMOVED_PLACEHOLDER_ALLOWED_HOSTS.has(host)) return true;
        return false;
    } catch {
        return /(?:^|\/\/)(?:(?:[a-z0-9-]+\.)?imgur\.com|i\.redd\.it|preview\.redd\.it|external-preview\.redd\.it)(?::\d+)?(?:\/|$)/i.test(url);
    }
}

/**
 * Checks if a URL points to an imgur domain (e.g. imgur.com, i.imgur.com).
 *
 * @param {string} url
 * @returns {boolean}
 */
export function isImgurHost(url) {
    if (!url || typeof url !== "string") return false;
    try {
        const target = url.startsWith("//") ? `https:${url}` : url;
        const parsed = new URL(target);
        const host = parsed.hostname.toLowerCase();
        return host === "imgur.com" || host.endsWith(".imgur.com");
    } catch {
        return /(?:^|\/\/)(?:[a-z0-9-]+\.)?imgur\.com(?::\d+)?(?:\/|$)/i.test(url);
    }
}

/**
 * Detects if an image matches a known "image deleted / removed" placeholder graphic
 * from an allow-listed image host (imgur, i.redd.it, preview.redd.it, external-preview.redd.it).
 *
 * @param {{ url?: string, width?: number, height?: number }} params
 * @returns {boolean}
 */
export function isRemovedImagePlaceholder(params) {
    if (!params || typeof params !== "object") return false;
    const { url, width, height } = params;
    if (!url || typeof url !== "string") return false;
    if (typeof width !== "number" || typeof height !== "number") return false;
    if (width <= 0 || height <= 0) return false;

    if (!isAllowedPlaceholderHost(url)) return false;

    return KNOWN_REMOVED_PLACEHOLDER_SIZES.some(
        (size) => size.width === width && size.height === height
    );
}

// Thin alias for backwards compatibility
export const isImgurRemovedPlaceholder = isRemovedImagePlaceholder;

/**
 * Attempts to extract a Reddit-hosted backup image URL from the post preview data.
 * Checks preview.images[0].source.url first, then the largest entry in resolutions.
 * Skips any URL identical to failedUrl.
 *
 * @param {object} post
 * @param {string} failedUrl
 * @returns {string | null}
 */
export function getRecoveryUrl(post, failedUrl) {
    if (!post || typeof post !== "object") return null;
    const cleanedFailed = cleanMediaUrl(failedUrl);

    const previewImage = post.preview?.images?.[0];
    if (!previewImage || typeof previewImage !== "object") return null;

    // 1. preview.images[0].source.url first
    const rawSource = previewImage.source?.url;
    const sourceUrl = cleanMediaUrl(rawSource);
    if (sourceUrl && sourceUrl !== cleanedFailed) {
        return sourceUrl;
    }

    // 2. Largest entry in preview.images[0].resolutions
    const resolutions = previewImage.resolutions;
    if (Array.isArray(resolutions) && resolutions.length > 0) {
        const sorted = [...resolutions].sort((a, b) => {
            const areaA = (typeof a?.width === "number" && typeof a?.height === "number")
                ? a.width * a.height
                : (a?.width || 0);
            const areaB = (typeof b?.width === "number" && typeof b?.height === "number")
                ? b.width * b.height
                : (b?.width || 0);
            return areaB - areaA;
        });

        for (const res of sorted) {
            const resUrl = cleanMediaUrl(res?.url);
            if (resUrl && resUrl !== cleanedFailed) {
                return resUrl;
            }
        }
    }

    return null;
}
