import useLocalStorage from '@/hooks/localStorage';
import { ChevronDown, Loader2 } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';

export type SortKey = 'title' | 'size';
export type SortDir = 'asc' | 'desc';

export interface ReleaseRow {
	title: string;
	size: number;
	isPack?: boolean;
}

/** Bytes → GB, matching how sizes read elsewhere on these pages. */
export function formatSize(bytes: number): string {
	if (!bytes) return '—';
	return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function sortResults<T extends ReleaseRow>(results: T[], key: SortKey, dir: SortDir): T[] {
	const factor = dir === 'asc' ? 1 : -1;
	return [...results].sort((a, b) => {
		if (key === 'size') return (a.size - b.size) * factor;
		return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }) * factor;
	});
}

type ReleaseSectionProps<T extends ReleaseRow> = {
	heading: ReactNode;
	/**
	 * Where the collapsed state lives. One key per section, not per title, so a
	 * section folded away on one movie stays folded on every movie and show.
	 */
	collapsedKey: string;
	/** "(12)" or "(3 of 12)", once there are results. */
	count?: string | null;
	isLoading?: boolean;
	/** Loading, error and empty messages, shown above the table. */
	status?: ReactNode;
	rows: T[];
	rowKey: (row: T) => string;
	/** The row's buttons; the only part that differs between the sections. */
	actions: (row: T) => ReactNode;
	/**
	 * Phones only: a line under the row's buttons, for text too long for a
	 * 122px button (a failure reason). Wider screens show it in the button.
	 */
	note?: (row: T) => ReactNode;
};

// One Usenet tab section: where the files go is the heading, and every button in
// it means the same thing. Both sections share this so they read and sort alike.
export function ReleaseSection<T extends ReleaseRow>({
	heading,
	collapsedKey,
	count,
	isLoading,
	status,
	rows,
	rowKey,
	actions,
	note,
}: ReleaseSectionProps<T>) {
	const [collapsed, setCollapsed] = useLocalStorage<boolean>(collapsedKey, false);
	const [sortKey, setSortKey] = useState<SortKey>('size');
	const [sortDir, setSortDir] = useState<SortDir>('desc');

	const changeSort = (key: SortKey) => {
		if (key === sortKey) {
			setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
			return;
		}
		setSortKey(key);
		// Biggest-first and A-Z are the useful defaults for their columns.
		setSortDir(key === 'size' ? 'desc' : 'asc');
	};
	const sortArrow = (key: SortKey) => (sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '');
	const sorted = useMemo(() => sortResults(rows, sortKey, sortDir), [rows, sortKey, sortDir]);

	return (
		<div className="mx-2 my-2 rounded border border-gray-700 bg-gray-800/30 max-sm:mx-0 max-sm:rounded-none max-sm:border-x-0">
			<h2 className="flex items-center">
				<button
					type="button"
					onClick={() => setCollapsed(!collapsed)}
					aria-expanded={!collapsed}
					className="flex min-w-0 flex-1 items-center gap-2 px-4 py-3 text-left font-medium text-gray-100 max-sm:px-3"
				>
					<ChevronDown
						className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${collapsed ? '-rotate-90' : ''}`}
					/>
					<span>{heading}</span>
					{count && <span className="text-sm text-gray-400">{count}</span>}
					{isLoading && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
				</button>
				{/* Phones drop the column header row; the same two sorts sit here. */}
				{!collapsed && sorted.length > 0 && (
					<span className="flex shrink-0 gap-1 pr-2 text-xs text-gray-400 sm:hidden">
						<button
							type="button"
							onClick={() => changeSort('title')}
							aria-label="Sort by name"
							className="rounded px-1.5 py-1 hover:text-gray-100"
						>
							Name{sortArrow('title')}
						</button>
						<button
							type="button"
							onClick={() => changeSort('size')}
							aria-label="Sort by size"
							className="rounded px-1.5 py-1 hover:text-gray-100"
						>
							Size{sortArrow('size')}
						</button>
					</span>
				)}
			</h2>

			{!collapsed && (
				<div className="border-t border-gray-700 px-2 pb-2 max-sm:px-0">
					{status}
					{sorted.length > 0 && (
						<div className="overflow-x-auto">
							{/* Phones: each row is a card, the release name across the full width with
							    size and the buttons beneath it; as columns the name got ~70px. */}
							<table className="w-full table-auto text-sm max-sm:block">
								<thead className="max-sm:hidden">
									<tr className="text-left text-gray-400">
										<th className="px-2 py-2">
											<button
												type="button"
												onClick={() => changeSort('title')}
												className="font-medium hover:text-gray-100"
											>
												Release{sortArrow('title')}
											</button>
										</th>
										<th className="w-28 px-2 py-2">
											<button
												type="button"
												onClick={() => changeSort('size')}
												className="font-medium hover:text-gray-100"
											>
												Size{sortArrow('size')}
											</button>
										</th>
										{/* Fixed, because the phase labels differ a lot in
										    length ("In RD" against "Real-Debrid downloading")
										    and a column that sizes to its content leaves the
										    buttons ragged down the page. Wider from
										    lg, where "Real-Debrid downloading" fits on
										    one line and a failure reason gets room. */}
										<th className="w-40 px-2 py-2 lg:w-64"></th>
									</tr>
								</thead>
								<tbody className="max-sm:block">
									{sorted.map((row) => (
										<tr
											key={rowKey(row)}
											className="border-t border-gray-700/60 align-middle max-sm:grid max-sm:grid-cols-[1fr_auto] max-sm:items-center"
										>
											<td className="px-2 py-2 break-all text-gray-100 max-sm:col-span-2 max-sm:pb-1 sm:py-1">
												{row.isPack && (
													<span className="mr-2 rounded border border-amber-500 bg-amber-900/30 px-1.5 py-0.5 text-xs whitespace-nowrap text-amber-100">
														Season pack
													</span>
												)}
												{row.title}
											</td>
											<td className="px-2 py-2 whitespace-nowrap text-gray-300 max-sm:pt-0 sm:py-1">
												{formatSize(row.size)}
											</td>
											<td className="px-2 py-2 max-sm:w-48 max-sm:pt-0 sm:py-1">
												<div className="flex items-stretch gap-1">
													{actions(row)}
												</div>
											</td>
											{note?.(row) && (
												<td className="hidden px-2 pb-2 text-xs break-words text-red-200/80 max-sm:col-span-2 max-sm:block">
													{note(row)}
												</td>
											)}
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</div>
			)}
		</div>
	);
}
