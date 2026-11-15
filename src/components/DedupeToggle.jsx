export function DedupeToggle({ hideDuplicates, onToggle, hiddenCount }) {
    return (
        <div className="flex items-center gap-2 text-[11px]">
            <label className="flex items-center gap-1.5 cursor-pointer text-[#818384] hover:text-[#d7dadc] select-none transition-colors">
                <input
                    type="checkbox"
                    checked={hideDuplicates}
                    onChange={(e) => onToggle(e.target.checked)}
                    className="accent-[#fe5301] rounded cursor-pointer"
                />
                <span>Hide duplicates</span>
            </label>
            {hideDuplicates && hiddenCount > 0 && (
                <span className="text-[#818384] bg-[#1a1a1b] border border-[#343536] px-1.5 py-0.5 rounded text-[10px]">
                    {hiddenCount} duplicate {hiddenCount === 1 ? 'post' : 'posts'} hidden
                </span>
            )}
        </div>
    );
}
