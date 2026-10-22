import type { UserTorrent } from '@/torrent/userTorrent';
import type { LibraryIdentification } from '@/utils/libraryIdentify';
import { normalize } from '@/utils/mediaId';

type TitleGroupState = {
	key: string;
	filter: string;
	count: number;
};

export type LibraryTitleGroup = Readonly<TitleGroupState>;

/** One render's identity, frequency and size decisions; consumers never mutate it. */
export interface LibraryGrouping {
	readonly titleGroupsById: Readonly<Record<string, LibraryTitleGroup>>;
	readonly parsedTitlesById: Readonly<Record<string, string>>;
	readonly tvTitlesById: Readonly<Record<string, string>>;
	readonly tvTitleCounts: ReadonlyMap<string, number>;
	readonly hashCounts: ReadonlyMap<string, number>;
	readonly duplicateTitleGroups: number;
	readonly duplicateHashes: number;
	readonly totalBytes: number;
}

export function buildLibraryGrouping(
	torrents: readonly UserTorrent[],
	identifications: Readonly<Record<string, LibraryIdentification>> = {}
): LibraryGrouping {
	const titleGroupsById: Record<string, LibraryTitleGroup> = Object.create(null);
	const parsedTitlesById: Record<string, string> = Object.create(null);
	const tvTitlesById: Record<string, string> = Object.create(null);
	const titles = new Map<string, TitleGroupState>();
	const tvTitleCounts = new Map<string, number>();
	const hashCounts = new Map<string, number>();
	let duplicateTitleGroups = 0;
	let duplicateHashes = 0;
	let totalBytes = 0;

	// Parsed titles bridge unidentified rows only when all known movies in
	// that bucket agree. An unidentified row must never join conflicting IDs.
	const movieIdsByTitle = new Map<string, string | null>();
	for (const torrent of torrents) {
		const parsedTitle = normalize(torrent.title);
		parsedTitlesById[torrent.id] = parsedTitle;
		const identification = identifications[torrent.id];
		if (torrent.mediaType !== 'movie' || identification?.kind !== 'movie') continue;
		const previous = movieIdsByTitle.get(parsedTitle);
		if (previous === undefined) {
			movieIdsByTitle.set(parsedTitle, identification.imdbId);
		} else if (previous !== identification.imdbId) {
			movieIdsByTitle.set(parsedTitle, null);
		}
	}

	for (const torrent of torrents) {
		const parsedTitle = parsedTitlesById[torrent.id];
		const identification = identifications[torrent.id];
		let movieId: string | undefined;
		if (torrent.mediaType === 'movie') {
			if (identification?.kind === 'movie') {
				movieId = identification.imdbId;
			} else if (!identification) {
				movieId = movieIdsByTitle.get(parsedTitle) ?? undefined;
			}
		}
		const filter = movieId ?? parsedTitle;
		const key = `${torrent.mediaType}:${movieId ? 'imdb' : 'title'}:${filter}`;
		let group = titles.get(key);
		if (!group) {
			group = { key, filter, count: 0 };
			titles.set(key, group);
		}
		titleGroupsById[torrent.id] = group;

		const tvTitle =
			torrent.mediaType === 'tv' && torrent.info?.title
				? normalize(torrent.info.title)
				: undefined;
		if (tvTitle !== undefined) tvTitlesById[torrent.id] = tvTitle;
		if (/^Magnet/.test(torrent.title)) continue;

		group.count++;
		if (group.count === 2) duplicateTitleGroups++;
		if (tvTitle !== undefined) {
			tvTitleCounts.set(tvTitle, (tvTitleCounts.get(tvTitle) ?? 0) + 1);
		}
		// A hashless transfer owns its bytes; it is never a same-hash duplicate.
		if (!torrent.hash) {
			totalBytes += torrent.bytes;
		} else {
			const count = (hashCounts.get(torrent.hash) ?? 0) + 1;
			hashCounts.set(torrent.hash, count);
			if (count === 1) totalBytes += torrent.bytes;
			if (count === 2) duplicateHashes++;
		}
	}

	return {
		titleGroupsById,
		parsedTitlesById,
		tvTitlesById,
		tvTitleCounts,
		hashCounts,
		duplicateTitleGroups,
		duplicateHashes,
		totalBytes,
	};
}

/** Select duplicate editions using the same identities displayed and filtered. */
export function duplicateLibraryTorrents(
	torrents: readonly UserTorrent[],
	grouping: LibraryGrouping,
	preferCandidate: (retained: UserTorrent, candidate: UserTorrent) => boolean
): UserTorrent[] {
	const retainedByTitle = new Map<string, UserTorrent>();
	const duplicates: UserTorrent[] = [];
	for (const torrent of torrents) {
		const key = grouping.titleGroupsById[torrent.id].key;
		const retained = retainedByTitle.get(key);
		if (!retained) {
			retainedByTitle.set(key, torrent);
		} else if (preferCandidate(retained, torrent)) {
			duplicates.push(retained);
			retainedByTitle.set(key, torrent);
		} else {
			duplicates.push(torrent);
		}
	}
	return duplicates;
}
