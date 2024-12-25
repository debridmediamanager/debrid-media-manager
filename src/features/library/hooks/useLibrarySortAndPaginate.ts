import { UserTorrent } from '@/torrent/userTorrent';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useState } from 'react';

const ITEMS_PER_PAGE = 100;

export interface SortBy {
	column: 'id' | 'filename' | 'title' | 'bytes' | 'progress' | 'status' | 'added';
	direction: 'asc' | 'desc';
}

export function useLibrarySortAndPaginate(filteredList: UserTorrent[]) {
	const router = useRouter();
	const [sortBy, setSortBy] = useState<SortBy>({ column: 'added', direction: 'desc' });
	const [currentPage, setCurrentPage] = useState(1);

	// Read page from query params
	useEffect(() => {
		const { page } = router.query;
		if (!page || Array.isArray(page)) return;
		setCurrentPage(parseInt(page, 10));
	}, [router.query]);

	// Handle sorting
	const handleSort = useCallback(
		(column: SortBy['column']) => {
			setSortBy({
				column,
				direction: sortBy.column === column && sortBy.direction === 'asc' ? 'desc' : 'asc',
			});
		},
		[sortBy]
	);

	// Sort data
	const sortedData = useCallback(() => {
		return [...filteredList].sort((a, b) => {
			const isAsc = sortBy.direction === 'asc';
			let comparison = 0;
			if (a[sortBy.column] > b[sortBy.column]) {
				comparison = 1;
			} else if (a[sortBy.column] < b[sortBy.column]) {
				comparison = -1;
			}
			return isAsc ? comparison : comparison * -1;
		});
	}, [filteredList, sortBy]);

	// Pagination handlers
	const handlePrevPage = useCallback(() => {
		if (currentPage > 1) {
			router.push({
				query: { ...router.query, page: currentPage - 1 },
			});
		}
	}, [currentPage, router]);

	const handleNextPage = useCallback(() => {
		router.push({
			query: { ...router.query, page: currentPage + 1 },
		});
	}, [currentPage, router]);

	// Get current page data
	const currentPageData = useCallback(() => {
		return sortedData().slice(
			(currentPage - 1) * ITEMS_PER_PAGE,
			(currentPage - 1) * ITEMS_PER_PAGE + ITEMS_PER_PAGE
		);
	}, [currentPage, sortedData]);

	return {
		sortBy,
		handleSort,
		currentPage,
		setCurrentPage,
		handlePrevPage,
		handleNextPage,
		currentPageData,
		maxPages: Math.ceil(filteredList.length / ITEMS_PER_PAGE),
	};
}
