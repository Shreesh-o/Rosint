/**
 * Archive failure classification and multi-archive status resolution.
 * Pure logic — zero external dependencies.
 */

import { fetchWithBackoff } from "../postLookup.js";

export const ERROR_CODES = Object.freeze({
    TIMEOUT: "timeout",
    RATE_LIMITED: "rate_limited",
    SERVER_ERROR: "server_error",
    BAD_RESPONSE: "bad_response",
});

/**
 * Classifies an HTTP response or Error object into one of:
 * - "timeout"
 * - "rate_limited"
 * - "server_error"
 * - "bad_response"
 *
 * @param {{ status?: number | null, error?: Error | string | null, response?: Response | null }} params
 * @returns {"timeout" | "rate_limited" | "server_error" | "bad_response"}
 */
export function classifyError({ status, error, response } = {}) {
    const code = status ?? response?.status;

    if (code === 429) {
        return ERROR_CODES.RATE_LIMITED;
    }
    if (typeof code === "number" && code >= 500) {
        return ERROR_CODES.SERVER_ERROR;
    }
    if (typeof code === "number" && code >= 400) {
        return ERROR_CODES.BAD_RESPONSE;
    }

    if (error) {
        const name = (error && typeof error === "object" ? error.name : "") || "";
        const msg = (error && typeof error === "object" ? error.message : String(error)) || "";

        if (name === "TimeoutError" || name === "AbortError" || /(?:time(?:d)?\s*out|timeout|abort)/i.test(msg) || /(?:time(?:d)?\s*out|timeout|abort)/i.test(name)) {
            return ERROR_CODES.TIMEOUT;
        }
        if (/json|syntax/i.test(name) || /json|syntax/i.test(msg) || /unexpected token/i.test(msg)) {
            return ERROR_CODES.BAD_RESPONSE;
        }
        return ERROR_CODES.SERVER_ERROR;
    }

    return ERROR_CODES.SERVER_ERROR;
}

/**
 * Executes a fetch with backoff and returns a normalized result:
 * { data: Array, ok: boolean, error: string | null, status: number | null }
 */
export async function safeArchiveFetch(url, {
    retry = true,
    retries,
    onRetry,
    fetcher = (...args) => fetch(...args),
    wait,
    now,
    random,
} = {}) {
    let failureInfo = null;
    const res = await fetchWithBackoff(url, {
        init: { headers: { Accept: "application/json" } },
        retries: retries !== undefined ? retries : (retry ? undefined : 0),
        fetcher,
        wait,
        now,
        random,
        onRetry,
        onFailure: (info) => { failureInfo = info; },
    });

    if (!res) {
        const error = classifyError(failureInfo || {});
        return { data: [], ok: false, error, status: failureInfo?.status ?? null };
    }

    try {
        const json = await res.json();
        const data = Array.isArray(json?.data) ? json.data : [];
        return { data, ok: true, error: null, status: res.status };
    } catch (err) {
        const error = classifyError({ response: res, error: err });
        return { data: [], ok: false, error, status: res.status };
    }
}

/**
 * Resolves the overall status across Arctic Shift and PullPush archives.
 *
 * An archive that answered successfully with zero items (ok: true, data: [])
 * is NOT a failure.
 *
 * @param {{ ok: boolean, data?: Array, error?: string | null }} arctic
 * @param {{ ok: boolean, data?: Array, error?: string | null }} pullpush
 * @returns {{
 *   state: "ok" | "partial" | "down",
 *   partial: boolean,
 *   down: boolean,
 *   rateLimited: boolean,
 *   failedArchive: string | null,
 *   errors: { arctic: string | null, pullpush: string | null }
 * }}
 */
export function resolveArchiveStatus(arctic, pullpush) {
    const arcticOk = Boolean(arctic?.ok);
    const pullpushOk = Boolean(pullpush?.ok);

    const arcticError = arcticOk ? null : (arctic?.error || ERROR_CODES.SERVER_ERROR);
    const pullpushError = pullpushOk ? null : (pullpush?.error || ERROR_CODES.SERVER_ERROR);

    const rateLimited = arcticError === ERROR_CODES.RATE_LIMITED || pullpushError === ERROR_CODES.RATE_LIMITED;

    if (arcticOk && pullpushOk) {
        return {
            state: "ok",
            partial: false,
            down: false,
            rateLimited: false,
            failedArchive: null,
            errors: { arctic: null, pullpush: null },
        };
    }

    if (arcticOk || pullpushOk) {
        return {
            state: "partial",
            partial: true,
            down: false,
            rateLimited,
            failedArchive: arcticOk ? "PullPush" : "Arctic Shift",
            errors: { arctic: arcticError, pullpush: pullpushError },
        };
    }

    return {
        state: "down",
        partial: false,
        down: true,
        rateLimited,
        failedArchive: null,
        errors: { arctic: arcticError, pullpush: pullpushError },
    };
}

/**
 * Merges items and sources from Arctic and PullPush responses and evaluates
 * overall archive status.
 */
export function combineArchiveResponses(arcticRes, pullpushRes) {
    const archiveStatus = resolveArchiveStatus(arcticRes, pullpushRes);
    const seen = new Set();
    const merged = [];
    const sources = [];

    if (arcticRes?.ok && arcticRes.data?.length > 0) sources.push("Arctic Shift");
    if (pullpushRes?.ok && pullpushRes.data?.length > 0) sources.push("PullPush");

    for (const item of [...(arcticRes?.data || []), ...(pullpushRes?.data || [])]) {
        if (item && item.id && !seen.has(item.id)) {
            seen.add(item.id);
            merged.push(item);
        }
    }

    return {
        items: merged,
        sources,
        archiveStatus,
        down: archiveStatus.down,
        partial: archiveStatus.partial,
        rateLimited: archiveStatus.rateLimited,
    };
}
