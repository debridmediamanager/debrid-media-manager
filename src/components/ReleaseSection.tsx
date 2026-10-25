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
		<div className="mx-2 my-4 rounded border border-gray-700 bg-gray-800/30">
			<h2>
				<button
					type="button"
					onClick={() => setCollapsed(!collapsed)}
					aria-expanded={!collapsed}
					className="flex w-full items-center gap-2 px-4 py-3 text-left font-medium text-gray-100"
				>
					<ChevronDown
						className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${collapsed ? '-rotate-90' : ''}`}
					/>
					<span>{heading}</span>
					{count && <span className="text-sm text-gray-400">{count}</span>}
					{isLoading && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
				</button>
			</h2>

			{!collapsed && (
				<div className="border-t border-gray-700 px-2 pb-2">
					{status}
					{sorted.length > 0 && (
						<div className="overflow-x-auto">
							<table className="w-full table-auto text-sm">
								<thead>
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
										    buttons ragged down the page. */}
										<th className="w-40 px-2 py-2"></th>
									</tr>
								</thead>
								<tbody>
									{sorted.map((row) => (
										<tr
											key={rowKey(row)}
											className="border-t border-gray-700/60 align-top"
										>
											<td className="px-2 py-2 break-all text-gray-100">
												{row.isPack && (
													<span className="mr-2 rounded border border-amber-500 bg-amber-900/30 px-1.5 py-0.5 text-xs whitespace-nowrap text-amber-100">
														Season pack
													</span>
												)}
												{row.title}
											</td>
											<td className="px-2 py-2 whitespace-nowrap text-gray-300">
												{formatSize(row.size)}
											</td>
											<td className="px-2 py-2">
												<div className="flex items-stretch gap-1">
													{actions(row)}
												</div>
											</td>
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
