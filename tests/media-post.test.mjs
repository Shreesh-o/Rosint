import { test } from "node:test";
import assert from "node:assert/strict";
import {
    hasMedia,
    getPostMedia,
    cleanMediaUrl,
    fmtNum,
    timeAgo,
    fullTimestamp,
    getStatus,
    statusBorder,
} from "../src/lib/postMedia.js";

test("cleanMediaUrl: decodes HTML entities and trims whitespace", () => {
    assert.equal(cleanMediaUrl("https://preview.redd.it/test.png?width=1080&amp;crop=smart&amp;s=abc"), "https://preview.redd.it/test.png?width=1080&crop=smart&s=abc");
    assert.equal(cleanMediaUrl("https://example.com/item?foo=1&#38;bar=2"), "https://example.com/item?foo=1&bar=2");
    assert.equal(cleanMediaUrl("  https://i.redd.it/cat.jpg  "), "https://i.redd.it/cat.jpg");
    assert.equal(cleanMediaUrl(""), "");
    assert.equal(cleanMediaUrl(null), "");
    assert.equal(cleanMediaUrl(undefined), "");
});

test("hasMedia: image post is recognized as media", () => {
    const post1 = {
        id: "p_img1",
        is_self: false,
        domain: "i.redd.it",
        url: "https://i.redd.it/abcdef123.jpg",
    };
    assert.equal(hasMedia(post1), true);
    const media1 = getPostMedia(post1);
    assert.equal(media1?.type, "image");
    assert.equal(media1?.url, "https://i.redd.it/abcdef123.jpg");
    assert.equal(media1?.originalUrl, "https://i.redd.it/abcdef123.jpg");

    const post2 = {
        id: "p_img2",
        is_self: false,
        post_hint: "image",
        url: "https://example.com/some-photo",
        preview: {
            images: [
                {
                    source: { url: "https://preview.redd.it/full.jpg?width=1080&amp;s=abc" },
                    resolutions: [{ url: "https://preview.redd.it/low.jpg?width=108&amp;s=xyz" }],
                },
            ],
        },
    };
    assert.equal(hasMedia(post2), true);
    const media2 = getPostMedia(post2);
    assert.equal(media2?.type, "image");
    // Prefers full-size source over low-resolution previews and decodes &amp;
    assert.equal(media2?.url, "https://preview.redd.it/full.jpg?width=1080&s=abc");
    assert.equal(media2?.originalUrl, "https://example.com/some-photo");
});

test("hasMedia: gallery is recognized as media and prefers full-size source", () => {
    const post = {
        id: "p_gal",
        is_self: false,
        is_gallery: true,
        gallery_data: {
            items: [{ media_id: "m1" }, { media_id: "m2" }],
        },
        media_metadata: {
            m1: {
                s: { u: "https://preview.redd.it/m1_full.jpg?width=1920&amp;s=111" },
                p: [{ u: "https://preview.redd.it/m1_thumb.jpg?width=108&amp;s=000" }],
            },
            m2: {
                s: { u: "https://preview.redd.it/m2_full.jpg?width=1920&amp;s=222" },
            },
        },
    };
    assert.equal(hasMedia(post), true);
    const media = getPostMedia(post);
    assert.equal(media?.type, "gallery");
    assert.equal(media?.items?.length, 2);
    // Prefers source (s.u) and decodes entities
    assert.equal(media?.items[0].url, "https://preview.redd.it/m1_full.jpg?width=1920&s=111");
    assert.equal(media?.items[1].url, "https://preview.redd.it/m2_full.jpg?width=1920&s=222");
});

test("hasMedia: reddit video is recognized as media", () => {
    const post = {
        id: "p_vid",
        is_self: false,
        is_video: true,
        domain: "v.redd.it",
        url: "https://v.redd.it/xyz789",
        media: {
            reddit_video: {
                fallback_url: "https://v.redd.it/xyz789/DASH_720.mp4?source=fallback&amp;tag=1",
            },
        },
        preview: {
            images: [{ source: { url: "https://preview.redd.it/poster.jpg?width=1080&amp;s=999" } }],
        },
    };
    assert.equal(hasMedia(post), true);
    const media = getPostMedia(post);
    assert.equal(media?.type, "video");
    assert.equal(media?.url, "https://v.redd.it/xyz789/DASH_720.mp4?source=fallback&tag=1");
    assert.equal(media?.poster, "https://preview.redd.it/poster.jpg?width=1080&s=999");
});

test("hasMedia: external gif/video is recognized as media", () => {
    const postGifv = {
        id: "p_gifv",
        is_self: false,
        domain: "i.imgur.com",
        url: "https://i.imgur.com/cat.gifv",
    };
    assert.equal(hasMedia(postGifv), true);
    const mediaGifv = getPostMedia(postGifv);
    assert.equal(mediaGifv?.type, "video");
    assert.equal(mediaGifv?.url, "https://i.imgur.com/cat.mp4");

    const postGfycat = {
        id: "p_gfycat",
        is_self: false,
        domain: "gfycat.com",
        url: "https://gfycat.com/funny-dog",
        preview: {
            reddit_video_preview: {
                fallback_url: "https://v.redd.it/gfycat_preview.mp4?amp=1",
            },
        },
    };
    assert.equal(hasMedia(postGfycat), true);
    const mediaGfycat = getPostMedia(postGfycat);
    assert.equal(mediaGfycat?.type, "video");
    assert.equal(mediaGfycat?.url, "https://v.redd.it/gfycat_preview.mp4?amp=1");
});

test("hasMedia: text post is NOT recognized as media", () => {
    const post = {
        id: "p_text",
        is_self: true,
        domain: "self.AskReddit",
        url: "https://www.reddit.com/r/AskReddit/comments/123/what_is_your_favorite/",
        selftext: "Tell us what you think!",
    };
    assert.equal(hasMedia(post), false);
    assert.equal(getPostMedia(post), null);
});

test("hasMedia: plain link post is NOT recognized as media", () => {
    const post = {
        id: "p_link",
        is_self: false,
        post_hint: "link",
        domain: "nytimes.com",
        url: "https://www.nytimes.com/2024/01/01/technology/ai-breakthrough.html",
    };
    assert.equal(hasMedia(post), false);
    assert.equal(getPostMedia(post), null);
});

test("hasMedia: null or malformed post degrades gracefully", () => {
    assert.equal(hasMedia(null), false);
    assert.equal(hasMedia(undefined), false);
    assert.equal(hasMedia({}), false);
});

test("formatting helpers: fmtNum, timeAgo, fullTimestamp, getStatus, statusBorder", () => {
    assert.equal(fmtNum(null), "0");
    assert.equal(fmtNum(42), "42");
    assert.equal(fmtNum(1500), "1.5k");

    const now = Math.floor(Date.now() / 1000);
    assert.equal(timeAgo(now - 10), "10s ago");
    assert.equal(timeAgo(now - 120), "2m ago");
    assert.equal(timeAgo(now - 7200), "2h ago");
    assert.equal(timeAgo(now - 86400 * 3), "3d ago");
    assert.equal(timeAgo(null), "");

    assert.ok(fullTimestamp(now).length > 0);
    assert.equal(fullTimestamp(null), "");

    const removedPost = { selftext: "[removed]" };
    assert.deepEqual(getStatus(removedPost, "posts"), { removed: true, deleted: false });

    const deletedPost = { author: "[deleted]" };
    assert.deepEqual(getStatus(deletedPost, "posts"), { removed: false, deleted: true });

    assert.ok(statusBorder({ removed: true, deleted: false }).includes("border-[#4a2626]"));
    assert.ok(statusBorder({ removed: false, deleted: true }).includes("border-[#41371f]"));
    assert.ok(statusBorder({ removed: false, deleted: false }).includes("border-[#343536]"));
});
