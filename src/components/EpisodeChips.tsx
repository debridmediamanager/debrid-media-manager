export interface EpisodeChipItem<F extends string | number> {
	/** What picking the chip filters to; null is "All". */
	filter: F | null;
	label: string;
	/** Releases behind the chip. "All" has none. */
	count?: number;
	/** Nothing to show: dimmed, and only clickable while it is the one selected. */
	empty?: boolean;
	/** Not aired yet: a dashed border. */
	unaired?: boolean;
	title?: string;
}

interface EpisodeChipsProps<F extends string | number> {
	items: EpisodeChipItem<F>[];
	selected: F | null;
	/** Called with null when the selected chip is picked again. */
	onSelect: (filter: F | null) => void;
	testId: string;
}

const SELECTED =
	'whitespace-nowrap rounded border-2 border-red-500 bg-red-900/30 px-2 py-0.5 text-xs text-red-100';
const IDLE =
	'whitespace-nowrap rounded border-2 border-yellow-500 bg-yellow-900/30 px-2 py-0.5 text-xs text-yellow-100 hover:bg-yellow-800/50';
const EMPTY =
	'whitespace-nowrap rounded border-2 border-yellow-500/40 bg-gray-800/40 px-2 py-0.5 text-xs text-gray-400 cursor-not-allowed';

/**
 * The episode row the anime and season pages share: All, the packs, one chip
 * per episode and whatever the names do not place. It scrolls sideways inside
 * itself, so a season of fifty episodes never widens the page.
 */
export default function EpisodeChips<F extends string | number>({
	items,
	selected,
	onSelect,
	testId,
}: EpisodeChipsProps<F>) {
	return (
		<div className="flex items-center gap-1 overflow-x-auto pb-1" data-testid={testId}>
			<span className="mr-1 shrink-0 text-xs text-gray-300">Episodes:</span>
			{items.map(({ filter, label, count, empty, unaired, title }) => {
				const isSelected = selected === filter;
				const disabled = !!empty && !isSelected;
				const base = isSelected ? SELECTED : disabled ? EMPTY : IDLE;
				return (
					<button
						key={String(filter)}
						type="button"
						onClick={() => onSelect(isSelected ? null : filter)}
						aria-pressed={isSelected}
						disabled={disabled}
						title={title}
						className={unaired ? `${base} border-dashed` : base}
					>
						{label}
						{count !== undefined && (
							<>
								{' '}
								<span className="text-gray-300">({count})</span>
							</>
						)}
					</button>
				);
			})}
		</div>
	);
}
