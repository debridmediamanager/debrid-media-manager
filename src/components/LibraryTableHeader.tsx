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
		// Below lg: the column headings become a row of sort controls; Actions has nothing to sort.
		<tr className="border-b border-gray-700 text-xs whitespace-nowrap max-lg:flex max-lg:flex-wrap max-lg:gap-x-3 max-lg:px-1 max-lg:[&>th]:w-auto max-lg:[&>th]:max-w-none max-lg:[&>th]:min-w-0 max-lg:[&>th:last-child]:hidden">
			<th
				className={`w-8 max-w-8 min-w-8 px-0.5 py-1 ${sortableClass('id')}`}
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
				className={`w-[500px] max-w-[500px] min-w-96 px-1 py-2 lg:w-full ${sortableClass('title')}`}
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
			{/* The row's status sits under its size, shown only while it says something,
			    so the one column sorts both ways. */}
			<th
				className="w-28 max-w-28 min-w-28 px-1 py-2 text-gray-300"
				aria-sort={
					sortBy.column === 'bytes' || sortBy.column === 'progress'
						? sortBy.direction === 'asc'
							? 'ascending'
							: 'descending'
						: 'none'
				}
			>
				<span
					className={sortableClass('bytes')}
					onClick={() => onSort('bytes')}
					role="button"
				>
					Size{sortIndicator('bytes')}
				</span>
				{' · '}
				<span
					className={sortableClass('progress')}
					onClick={() => onSort('progress')}
					role="button"
				>
					Status{sortIndicator('progress')}
				</span>
			</th>
			<th
				className={`w-20 max-w-20 min-w-20 px-1 py-2 ${sortableClass('added')}`}
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
			<th className="w-24 max-w-28 min-w-24 px-1 py-2 text-gray-300">Actions</th>
		</tr>
	);
}
