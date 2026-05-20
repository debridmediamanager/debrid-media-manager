interface LibraryTableHeaderProps {
	sortBy: {
		column: 'id' | 'filename' | 'title' | 'bytes' | 'progress' | 'status' | 'added';
		direction: 'asc' | 'desc';
	};
	onSort: (
		column: 'id' | 'filename' | 'title' | 'bytes' | 'progress' | 'status' | 'added'
	) => void;
	filteredListLength: number;
	selectedTorrentsSize: number;
}

export default function LibraryTableHeader({
	sortBy,
	onSort,
	filteredListLength,
	selectedTorrentsSize,
}: LibraryTableHeaderProps) {
	const sortIndicator = (column: string) =>
		sortBy.column === column ? (sortBy.direction === 'asc' ? ' ↑' : ' ↓') : '';

	const sortableClass = (column: string) =>
		`cursor-pointer select-none hover:text-gray-100 ${sortBy.column === column ? 'text-cyan-300' : 'text-gray-300'}`;

	return (
		<tr className="whitespace-nowrap border-b border-gray-700 text-xs">
			<th
				className={`w-8 min-w-8 max-w-8 px-0.5 py-1 ${sortableClass('id')}`}
				onClick={() => onSort('id')}
				role="button"
				aria-sort={
					sortBy.column === 'id'
						? sortBy.direction === 'asc'
							? 'ascending'
							: 'descending'
						: 'none'
				}
			>
				Select
				{selectedTorrentsSize ? ` (${selectedTorrentsSize})` : ''}
				{sortIndicator('id')}
			</th>
			<th
				className={`w-[500px] min-w-96 max-w-[500px] px-1 py-2 ${sortableClass('title')}`}
				onClick={() => onSort('title')}
				role="button"
				aria-sort={
					sortBy.column === 'title'
						? sortBy.direction === 'asc'
							? 'ascending'
							: 'descending'
						: 'none'
				}
			>
				Title ({filteredListLength}){sortIndicator('title')}
			</th>
			<th
				className={`w-20 min-w-20 max-w-20 px-1 py-2 ${sortableClass('bytes')}`}
				onClick={() => onSort('bytes')}
				role="button"
				aria-sort={
					sortBy.column === 'bytes'
						? sortBy.direction === 'asc'
							? 'ascending'
							: 'descending'
						: 'none'
				}
			>
				Size{sortIndicator('bytes')}
			</th>
			<th
				className={`w-20 min-w-20 max-w-20 px-1 py-2 ${sortableClass('progress')}`}
				onClick={() => onSort('progress')}
				role="button"
				aria-sort={
					sortBy.column === 'progress'
						? sortBy.direction === 'asc'
							? 'ascending'
							: 'descending'
						: 'none'
				}
			>
				Status{sortIndicator('progress')}
			</th>
			<th
				className={`w-24 min-w-24 max-w-28 px-1 py-2 ${sortableClass('added')}`}
				onClick={() => onSort('added')}
				role="button"
				aria-sort={
					sortBy.column === 'added'
						? sortBy.direction === 'asc'
							? 'ascending'
							: 'descending'
						: 'none'
				}
			>
				Added{sortIndicator('added')}
			</th>
			<th className="w-24 min-w-24 max-w-28 px-1 py-2 text-gray-300">Actions</th>
		</tr>
	);
}
