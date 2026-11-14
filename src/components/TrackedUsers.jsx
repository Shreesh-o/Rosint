import { useState, useEffect, useCallback } from 'react';
import { loadTracked, addUser, removeUser } from '../lib/trackedUsers.js';
import { normalizeUsername } from '../normalizeUsername.js';

const TRACKED_CHANGED_EVENT = 'rosint:tracked-users-changed';

function dispatchTrackedChanged(updatedData) {
    window.dispatchEvent(new CustomEvent(TRACKED_CHANGED_EVENT, { detail: updatedData }));
}

/**
 * Compact list of tracked usernames.
 * Renders nothing if /api/tracked is unavailable or if no users are tracked.
 */
export function TrackedUsers({ onSelectUser }) {
    const [trackedData, setTrackedData] = useState(null);
    const [removing, setRemoving] = useState(null);
    const [error, setError] = useState(null);

    const refresh = useCallback(async () => {
        const data = await loadTracked();
        setTrackedData(data);
    }, []);

    useEffect(() => {
        let mounted = true;
        loadTracked().then((data) => {
            if (mounted) setTrackedData(data);
        });

        const handleChange = (e) => {
            if (!mounted) return;
            if (e.detail && Array.isArray(e.detail.users)) {
                setTrackedData(e.detail);
            } else {
                refresh();
            }
        };

        window.addEventListener(TRACKED_CHANGED_EVENT, handleChange);
        return () => {
            mounted = false;
            window.removeEventListener(TRACKED_CHANGED_EVENT, handleChange);
        };
    }, [refresh]);

    if (!trackedData || !Array.isArray(trackedData.users) || trackedData.users.length === 0) {
        return null;
    }

    async function handleRemove(e, username) {
        e.preventDefault();
        e.stopPropagation();
        if (removing) return;

        setRemoving(username);
        setError(null);
        try {
            const updated = await removeUser(username);
            setTrackedData(updated);
            dispatchTrackedChanged(updated);
        } catch {
            setError('Failed to remove');
            setTimeout(() => setError(null), 3000);
        } finally {
            setRemoving(null);
        }
    }

    return (
        <div className="flex flex-wrap items-center gap-1.5 mt-2.5 text-[11px]">
            <span className="text-[#818384] font-medium select-none">Tracked:</span>
            {trackedData.users.map((u) => (
                <span
                    key={u.username}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#1a1a1b] border border-[#343536] hover:border-[#818384] text-[#d7dadc] transition-colors"
                >
                    <button
                        type="button"
                        onClick={() => onSelectUser?.(u.username)}
                        className="hover:text-[#ff4500] transition-colors cursor-pointer"
                        title={`Search u/${u.username}`}
                    >
                        u/{u.username}
                    </button>
                    <button
                        type="button"
                        onClick={(e) => handleRemove(e, u.username)}
                        disabled={removing === u.username}
                        aria-label={`Untrack u/${u.username}`}
                        title="Untrack user"
                        className="text-[#818384] hover:text-[#ff4500] transition-colors ml-0.5 cursor-pointer disabled:opacity-50"
                    >
                        ×
                    </button>
                </span>
            ))}
            {error && <span className="text-red-400 text-[11px] ml-1">{error}</span>}
        </div>
    );
}

/**
 * Toggle button next to user profile header.
 * Shows "Track" or "Untrack" based on current tracked status.
 * Renders nothing if /api/tracked is unavailable or if user is blocked.
 */
export function TrackToggle({ username, searchBlocked }) {
    const [trackedData, setTrackedData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const refresh = useCallback(async () => {
        const data = await loadTracked();
        setTrackedData(data);
    }, []);

    useEffect(() => {
        let mounted = true;
        loadTracked().then((data) => {
            if (mounted) setTrackedData(data);
        });

        const handleChange = (e) => {
            if (!mounted) return;
            if (e.detail && Array.isArray(e.detail.users)) {
                setTrackedData(e.detail);
            } else {
                refresh();
            }
        };

        window.addEventListener(TRACKED_CHANGED_EVENT, handleChange);
        return () => {
            mounted = false;
            window.removeEventListener(TRACKED_CHANGED_EVENT, handleChange);
        };
    }, [refresh]);

    // Silently hide when blocked or when tracking API is unavailable
    if (searchBlocked || !username || !trackedData) {
        return null;
    }

    const clean = normalizeUsername(username).toLowerCase();
    const isTracked = trackedData.users.some(
        (u) => normalizeUsername(u.username).toLowerCase() === clean
    );

    async function handleToggle() {
        if (loading || !username) return;
        setLoading(true);
        setError(null);
        try {
            if (isTracked) {
                const updated = await removeUser(username);
                setTrackedData(updated);
                dispatchTrackedChanged(updated);
            } else {
                const updated = await addUser(username);
                setTrackedData(updated);
                dispatchTrackedChanged(updated);
            }
        } catch {
            setError(isTracked ? 'Failed to untrack' : 'Failed to track');
            setTimeout(() => setError(null), 3000);
        } finally {
            setLoading(false);
        }
    }

    return (
        <span className="inline-flex items-center gap-1.5 ml-2">
            <button
                type="button"
                onClick={handleToggle}
                disabled={loading}
                className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium border transition-colors cursor-pointer disabled:opacity-50 ${
                    isTracked
                        ? 'bg-[#272729] text-[#d7dadc] border-[#4a4a4b] hover:border-[#ff4500] hover:text-[#ff4500]'
                        : 'bg-[#1a1a1b] text-[#818384] border-[#343536] hover:border-[#ff4500] hover:text-[#d7dadc]'
                }`}
            >
                {loading ? '…' : isTracked ? 'Untrack' : 'Track'}
            </button>
            {error && <span className="text-red-400 text-[11px]">{error}</span>}
        </span>
    );
}
