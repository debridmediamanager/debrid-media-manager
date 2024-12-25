import { UserTorrent } from '@/torrent/userTorrent';
import { normalize } from '@/utils/mediaId';
import { quickSearchLibrary } from '@/utils/quickSearch';
import { isFailed, isInProgress, isSlowOrNoLinks } from '@/utils/slow';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';

export interface GroupingState {
	defaultTitleGrouping: Record<string, number>;
	movieTitleGrouping: Record<string, number>;
	tvGroupingByEpisode: Record<string, number>;
	tvGroupingByTitle: Record<string, number>;
	hashGrouping: Record<string, number>;
	sameTitle: Set<string>;
	sameHash: Set<string>;
}

export function useLibraryFilter(
	userTorrentsList: UserTorrent[],
	loading: boolean,
	uncachedRdHashes: Set<string>,
	uncachedAdIDs: string[],
	selectedTorrents: Set<string>
) {
	const router = useRouter();
	const {
		title: titleFilter,
		tvTitle: tvTitleFilter,
		hash: hashFilter,
		status,
		mediaType,
	} = router.query;

	const [query, setQuery] = useState('');
	const [filtering, setFiltering] = useState(false);
	const [grouping, setGrouping] = useState(false);
	const [filteredList, setFilteredList] = useState<UserTorrent[]>([]);
	const [totalBytes, setTotalBytes] = useState<number>(0);

	// Grouping state
	const [groupingState] = useState<GroupingState>({
		defaultTitleGrouping: {},
		movieTitleGrouping: {},
		tvGroupingByEpisode: {},
		tvGroupingByTitle: {},
		hashGrouping: {},
		sameTitle: new Set(),
		sameHash: new Set(),
	});

	// Filter counts
	const [slowCount, setSlowCount] = useState(0);
	const [inProgressCount, setInProgressCount] = useState(0);
	const [failedCount, setFailedCount] = useState(0);

	// Helper function to clear groupings
	const clearGroupings = (frequencyMap: Record<string, number>) => {
		Object.keys(frequencyMap).forEach((key) => delete frequencyMap[key]);
	};

	// Helper function to get title groupings based on media type
	const getTitleGroupings = (mediaType: UserTorrent['mediaType']) => {
		switch (mediaType) {
			case 'movie':
				return groupingState.movieTitleGrouping;
			case 'tv':
				return groupingState.tvGroupingByEpisode;
			default:
				return groupingState.defaultTitleGrouping;
		}
	};

	// Aggregate metadata
	useEffect(() => {
		if (loading) return;

		setGrouping(true);
		setTotalBytes(0);
		groupingState.sameTitle.clear();
		groupingState.sameHash.clear();

		// Clear all groupings
		clearGroupings(groupingState.defaultTitleGrouping);
		clearGroupings(groupingState.movieTitleGrouping);
		clearGroupings(groupingState.tvGroupingByEpisode);
		clearGroupings(groupingState.tvGroupingByTitle);
		clearGroupings(groupingState.hashGrouping);

		for (const t of userTorrentsList) {
			if (/^Magnet/.test(t.title)) continue;

			// Group by hash
			if (t.hash in groupingState.hashGrouping) {
				if (groupingState.hashGrouping[t.hash] === 1) {
					groupingState.sameHash.add(t.hash);
				}
				groupingState.hashGrouping[t.hash]++;
			} else {
				groupingState.hashGrouping[t.hash] = 1;
				setTotalBytes((prev) => prev + t.bytes);
			}

			// Group by title
			const titleId = normalize(t.title);
			const titleGrouping = getTitleGroupings(t.mediaType);
			if (titleId in titleGrouping) {
				if (titleGrouping[titleId] === 1) {
					groupingState.sameTitle.add(titleId);
				}
				titleGrouping[titleId]++;
			} else {
				titleGrouping[titleId] = 1;
			}

			// Group by tv title
			if (t.mediaType === 'tv' && t.info?.title) {
				const tvShowTitleId = normalize(t.info.title);
				if (tvShowTitleId in groupingState.tvGroupingByTitle) {
					groupingState.tvGroupingByTitle[tvShowTitleId]++;
				} else {
					groupingState.tvGroupingByTitle[tvShowTitleId] = 1;
				}
			}
		}
		setGrouping(false);
	}, [userTorrentsList, loading]);

	// Filter the list
	useEffect(() => {
		if (loading || grouping) return;
		setFiltering(true);

		// Update counts
		setSlowCount(userTorrentsList.filter(isSlowOrNoLinks).length);
		setInProgressCount(userTorrentsList.filter(isInProgress).length);
		setFailedCount(userTorrentsList.filter(isFailed).length);

		let tmpList = userTorrentsList;

		// Apply filters based on status
		if (status === 'slow') {
			tmpList = tmpList.filter(isSlowOrNoLinks);
		} else if (status === 'inprogress') {
			tmpList = tmpList.filter(isInProgress);
		} else if (status === 'failed') {
			tmpList = tmpList.filter(isFailed);
		} else if (status === 'uncached') {
			tmpList = tmpList.filter(
				(t) =>
					(t.id.startsWith('rd:') && uncachedRdHashes.has(t.hash)) ||
					(t.id.startsWith('ad:') && uncachedAdIDs.includes(t.id))
			);
		} else if (status === 'sametitle') {
			tmpList = tmpList.filter((t) => groupingState.sameTitle.has(normalize(t.title)));
		} else if (status === 'samehash') {
			tmpList = tmpList.filter((t) => groupingState.sameHash.has(t.hash));
		} else if (status === 'selected') {
			tmpList = tmpList.filter((t) => selectedTorrents.has(t.id));
		}

		// Apply filters based on title/hash
		if (titleFilter) {
			const decoded = decodeURIComponent(titleFilter as string);
			tmpList = tmpList.filter((t) => normalize(t.title) === decoded);
		}
		if (tvTitleFilter) {
			const decoded = decodeURIComponent(tvTitleFilter as string);
			tmpList = tmpList.filter(
				(t) => t.mediaType === 'tv' && t.info?.title && normalize(t.info.title) === decoded
			);
		}
		if (hashFilter) {
			tmpList = tmpList.filter((t) => t.hash === hashFilter);
		}
		if (mediaType) {
			tmpList = tmpList.filter((t) => t.mediaType === mediaType);
		}

		// Apply quick search
		setFilteredList(quickSearchLibrary(query, tmpList));
		setFiltering(false);
	}, [
		router.query,
		userTorrentsList,
		loading,
		grouping,
		query,
		uncachedRdHashes,
		uncachedAdIDs,
		selectedTorrents,
	]);

	const hasNoQueryParamsBut = (...params: string[]) =>
		Object.keys(router.query).filter((p) => !params.includes(p)).length === 0;

	return {
		query,
		setQuery,
		filtering,
		grouping,
		filteredList,
		totalBytes,
		slowCount,
		inProgressCount,
		failedCount,
		groupingState,
		hasNoQueryParamsBut,
	};
}
