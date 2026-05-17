import { UserTorrent, UserTorrentStatus } from '@/torrent/userTorrent';
import { normalize } from '@/utils/mediaId';
import { isFailed, isInProgress, isSlowOrNoLinks } from '@/utils/slow';

const RD_BLOCKED_SUBSTRINGS = ['web-dl', 'webrip', 'bdrip', 'hdrip', 'dvdrip'];
const RD_BLOCKED_DOT_PAIRS: [string, string][] = [
	['bluray', 'x264'],
	['hdtv', 'x264'],
	['hdtv', 'xvid'],
	['web', 'x264'],
	['web', 'h264'],
];

export function isRdBlockedFilename(filename: string): boolean {
	const lower = filename.toLowerCase();
	for (const sub of RD_BLOCKED_SUBSTRINGS) {
		if (lower.includes(sub)) return true;
	}
	for (const [source, codec] of RD_BLOCKED_DOT_PAIRS) {
		if (lower.includes(`${source}.${codec}`)) return true;
	}
	return false;
}

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
	sameTitle?: Set<string>;
	sameHash?: Set<string>;
	uncachedRdHashes?: Set<string>;
	uncachedAdIDs?: string[];
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
	sameTitle = new Set<string>(),
	sameHash = new Set<string>(),
	uncachedRdHashes = new Set<string>(),
	uncachedAdIDs = [],
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
		filteredList = filteredList.filter(
			(torrent) =>
				(torrent.status === UserTorrentStatus.finished &&
					torrent.id.startsWith('rd:') &&
					uncachedRdHashes.has(torrent.hash)) ||
				(torrent.id.startsWith('ad:') && uncachedAdIDs.includes(torrent.id))
		);
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
			"RD torrents with filenames matching Real-Debrid's blocked patterns (web-dl, webrip, bdrip, hdrip, dvdrip, and certain source.codec combos). These may fail to add on Real-Debrid. This is a minimum count — only torrent names are checked, not individual files inside. Use zurg's manage page for the full count.";
	}
	if (statusValue === 'sametitle') {
		filteredList = filteredList.filter((torrent) => sameTitle.has(normalize(torrent.title)));
	}
	if (statusValue === 'samehash') {
		filteredList = filteredList.filter((torrent) => sameHash.has(torrent.hash));
	}
	if (titleValue) {
		const decoded = decodeURIComponent(titleValue);
		filteredList = filteredList.filter((torrent) => normalize(torrent.title) === decoded);
	}
	if (tvTitleValue) {
		const decoded = decodeURIComponent(tvTitleValue);
		filteredList = filteredList.filter(
			(torrent) =>
				torrent.mediaType === 'tv' &&
				torrent.info?.title &&
				normalize(torrent.info.title) === decoded
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
		};
		nextHelpText = `Showing torrents from ${serviceNames[serviceValue] ?? serviceValue}`;
	}

	return { list: filteredList, helpText: nextHelpText };
};
