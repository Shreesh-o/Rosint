import { useState } from 'react';
import { formatRelativeTime, clearProfileCache } from '../lib/profileCache.js';

export function CacheBanner({ cacheInfo, onRefresh, refreshing }) {
    if (!cacheInfo || !cacheInfo.isCached) return null;

    const timeStr = formatRelativeTime(cacheInfo.savedAt);

    return (
        <div className="flex items-center justify-between gap-2 px-3 py-1.5 mb-3 rounded bg-[#1a1a1b] border border-[#343536] text-[11px] text-[#818384]">
            <span className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${cacheInfo.error ? 'bg-amber-400' : 'bg-[#ff4500]'}`} />
                <span>
                    {cacheInfo.error ? (
                        <span className="text-amber-300 font-medium">{cacheInfo.error}</span>
                    ) : (
                        <>
                            Cached · {timeStr}
                            {refreshing && <span className="text-[#d7dadc]"> · Refreshing…</span>}
                        </>
                    )}
                </span>
            </span>
            <button
                type="button"
                onClick={onRefresh}
                disabled={refreshing}
                className="px-2 py-0.5 rounded bg-[#272729] hover:bg-[#343536] text-[#d7dadc] hover:text-white transition-colors cursor-pointer disabled:opacity-50 text-[10px] font-medium"
            >
                {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
        </div>
    );
}

export function ClearCacheButton() {
    const [cleared, setCleared] = useState(false);

    async function handleClear(e) {
        e.preventDefault();
        await clearProfileCache();
        setCleared(true);
        setTimeout(() => setCleared(false), 2500);
    }

    return (
        <button
            type="button"
            onClick={handleClear}
            className="text-[11px] text-[#818384] hover:text-[#d7dadc] underline transition-colors cursor-pointer"
            title="Purge locally cached profiles"
        >
            {cleared ? 'Cache cleared' : 'Clear cache'}
        </button>
    );
}
