import { UserTorrent } from '@/torrent/userTorrent';
import type { LibraryGrouping } from '@/utils/libraryGrouping';
import { isRdBlockedFilename } from '@/utils/rdFilenameFilter';
import { isFailed, isInProgress, isSlowOrNoLinks, isUncached } from '@/utils/slow';

export { isRdBlockedFilename };

type QueryValue = string | string[] | undefined;

const pickValue = (value: QueryValue) => {
	if (!value) return undefined;
	return Array.isArray(value) ? value[0] : value;
};

export interface LibraryFilterOptions {
	torrents: UserTorrent[];
	status?: QueryValue;
	titleFilter?: QueryValue;
	tvTitleFilter?: QueryValue;
	hashFilter?: QueryValue;
	mediaType?: QueryValue;
	service?: QueryValue;
	selectedTorrents?: Set<string>;
	grouping: LibraryGrouping;
}

export interface LibraryFilterResult {
	list: UserTorrent[];
	helpText: string | null;
}

export const filterLibraryItems = ({
	torrents,
	status,
	titleFilter,
	tvTitleFilter,
	hashFilter,
	mediaType,
	service,
	selectedTorrents = new Set<string>(),
	grouping,
}: LibraryFilterOptions): LibraryFilterResult => {
	let filteredList = torrents;
	let nextHelpText: string | null = null;

	const statusValue = pickValue(status);
	const titleValue = pickValue(titleFilter);
	const tvTitleValue = pickValue(tvTitleFilter);
	const hashValue = pickValue(hashFilter);
	const mediaValue = pickValue(mediaType);
	const serviceValue = pickValue(service);

	if (statusValue === 'slow') {
		filteredList = filteredList.filter(isSlowOrNoLinks);
		nextHelpText =
			'The displayed torrents are older than one hour and lack any seeders. You can use the "Delete shown" option to remove them.';
	}
	if (statusValue === 'inprogress') {
		filteredList = filteredList.filter(isInProgress);
		nextHelpText = 'Torrents that are still downloading';
	}
	if (statusValue === 'failed') {
		filteredList = filteredList.filter(isFailed);
		nextHelpText = 'Torrents that have a failure status';
	}
	if (statusValue === 'uncached') {
		filteredList = filteredList.filter(isUncached);
		nextHelpText = 'Torrents that are no longer cached';
	}
	if (statusValue === 'selected') {
		filteredList = filteredList.filter((torrent) => selectedTorrents.has(torrent.id));
		nextHelpText = 'Torrents that you have selected';
	}
	if (statusValue === 'rdblocked') {
		filteredList = filteredList.filter(
			(torrent) => torrent.id.startsWith('rd:') && isRdBlockedFilename(torrent.filename)
		);
		nextHelpText =
			"RD torrents whose names match Real-Debrid's filename filter (WEB-DL, WEB.x264 or WEB.H264 in exactly that case; WEBRip, BDRip, HDRip, DVDRip, HDTV.x264, HDTV.XviD, BluRay.x264 or p.BluRay.DTS in any case). RD refuses to add these. This is a minimum count — only torrent names are checked, not the files inside, which RD refuses to stream when their own names match. Use zurg's manage page for the full count.";
	}
	if (statusValue === 'sametitle') {
		filteredList = filteredList.filter(
			(torrent) => grouping.titleGroupsById[torrent.id].count > 1
		);
	}
	if (statusValue === 'samehash') {
		filteredList = filteredList.filter(
			(torrent) => (grouping.hashCounts.get(torrent.hash) ?? 0) > 1
		);
	}
	if (titleValue) {
		const decoded = decodeURIComponent(titleValue);
		filteredList = filteredList.filter(
			(torrent) =>
				grouping.titleGroupsById[torrent.id].filter === decoded ||
				grouping.parsedTitlesById[torrent.id] === decoded
		);
	}
	if (tvTitleValue) {
		const decoded = decodeURIComponent(tvTitleValue);
		filteredList = filteredList.filter(
			(torrent) => grouping.tvTitlesById[torrent.id] === decoded
		);
	}
	if (hashValue) {
		filteredList = filteredList.filter((torrent) => torrent.hash === hashValue);
	}
	if (mediaValue) {
		filteredList = filteredList.filter((torrent) => mediaValue === torrent.mediaType);
		nextHelpText = `Torrents shown are detected as ${['movies', 'TV shows', 'non-movie/TV content'][['movie', 'tv', 'other'].indexOf(mediaValue as string)]}.`;
	}
	if (serviceValue) {
		filteredList = filteredList.filter((torrent) => torrent.id.startsWith(`${serviceValue}:`));
		const serviceNames: Record<string, string> = {
			rd: 'Real-Debrid',
			ad: 'AllDebrid',
			tb: 'TorBox',
			pm: 'Premiumize',
			oc: 'Offcloud',
			dl: 'Debrid-Link',
		};
		nextHelpText = `Showing torrents from ${serviceNames[serviceValue] ?? serviceValue}`;
	}

	return { list: filteredList, helpText: nextHelpText };
};
