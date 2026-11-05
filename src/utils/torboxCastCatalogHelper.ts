import { repository as db } from '@/services/repository';
import { getTorrentList, getUsenetList, getWebDownloadList } from '@/services/torbox';
import { TorBoxTorrentInfo, TorBoxUsenetDownload, TorBoxWebDownload } from '@/services/types';
import { libraryArtFor, withLibraryArt } from '@/utils/castLibraryArt';
import { parseTorBoxCastTarget } from '@/utils/torboxWebDownload';

export const PAGE_SIZE = 12;

const asList = <T>(data: T[] | T | null | undefined): T[] =>
	!data ? [] : Array.isArray(data) ? data : [data];

/**
 * The cast profile, or null when there is none. A database error propagates:
 * read as "no profile", it would tell the member to set up an addon that is
 * fine, over an outage that is ours.
 */
async function getProfile(userid: string) {
	return db.getTorBoxCastProfile(userid);
}

/**
 * Every web download and usenet download in the account, as library metas.
 *
 * Unpaged on purpose: TorBox keeps these in tables of their own whose ids are
 * unrelated to torrent ids, so there is no single offset that walks all three.
 * Reading the two short lists whole is what makes the combined paging below
 * arithmetic instead of guesswork. Losing either must not cost the user their
 * torrents, so a failure degrades to an empty list - the same bargain the web
 * library strikes in `fetchTorrents`.
 */
async function fetchSideLists(apiKey: string) {
	const read = async <T>(
		label: string,
		call: () => Promise<{ success: boolean; data: T[] | T | null } | undefined>
	): Promise<T[]> => {
		try {
			const response = await call();
			if (!response?.success) return [];
			return asList(response.data);
		} catch (error) {
			console.error(
				`[TorBox Library] ${label} unavailable:`,
				error instanceof Error ? error.message : 'Unknown error'
			);
			return [];
		}
	};

	const [webDownloads, usenetDownloads] = await Promise.all([
		read<TorBoxWebDownload>('web downloads', () => getWebDownloadList(apiKey)),
		read<TorBoxUsenetDownload>('usenet downloads', () => getUsenetList(apiKey)),
	]);

	return [
		...webDownloads
			.filter((item) => item.download_finished && item.download_present)
			.map((item) => ({
				id: `dmm-tb:w${item.id}`,
				name: item.name,
				type: 'other',
			})),
		...usenetDownloads
			.filter((item) => item.download_finished && item.download_present)
			.map((item) => ({
				id: `dmm-tb:u${item.id}`,
				name: item.name,
				type: 'other',
			})),
	];
}

/**
 * One page of the user's TorBox library: web and usenet downloads, then torrents.
 *
 * The lists are concatenated rather than interleaved because their ids come from
 * different tables and carry no comparable ordering. Torrent offsets count only
 * playable entries, so expired rows cannot leave a hole that hides later pages.
 */
export async function getTorBoxDMMLibrary(userid: string, page: number) {
	const profile = await getProfile(userid);
	if (!profile) {
		return { error: 'Go to DMM and connect your TorBox account', status: 401 };
	}

	const skip = (page - 1) * PAGE_SIZE;
	const sideList = await fetchSideLists(profile.apiKey);

	const sideSlice = sideList.slice(skip, skip + PAGE_SIZE);
	const torrentOffset = skip < sideList.length ? 0 : skip - sideList.length;
	const torrentLimit = PAGE_SIZE - sideSlice.length;

	let torrents: TorBoxTorrentInfo[] = [];
	if (torrentLimit > 0) {
		const playable: TorBoxTorrentInfo[] = [];
		for (let offset = 0; playable.length < torrentOffset + torrentLimit; offset += 1000) {
			const results = await getTorrentList(profile.apiKey, { offset, limit: 1000 });
			if (!results.success) {
				return { error: 'Failed to get user torrents list', status: 500 };
			}
			const batch = asList(results.data);
			playable.push(
				...batch.filter((torrent) => torrent.download_finished && torrent.download_present)
			);
			if (batch.length < 1000) break;
		}
		torrents = playable.slice(torrentOffset, torrentOffset + torrentLimit);
	}

	// Only torrents carry an info hash, so only they can be identified.
	const metas = await withLibraryArt([
		...sideSlice.map((meta) => ({ meta })),
		...torrents.map((torrent) => ({
			meta: { id: `dmm-tb:${torrent.id}`, name: torrent.name, type: 'other' },
			hash: torrent.hash,
		})),
	]);

	// TorBox reports no total, so a full page is the only signal that more exist.
	return {
		data: { metas, hasMore: metas.length === PAGE_SIZE, cacheMaxAge: 0 },
		status: 200,
	};
}

/**
 * The meta for one library entry.
 *
 * `entryId` is the id part of a `dmm-tb:` meta id: `123` for a torrent, `w123`
 * for a web download, `u123` for a usenet download - the same shape the cast
 * route already parses.
 */
export async function getTorBoxDMMTorrent(userid: string, entryId: string) {
	const profile = await getProfile(userid);
	if (!profile) {
		return { error: 'Go to DMM and connect your TorBox account', status: 401 };
	}

	const target = parseTorBoxCastTarget(entryId);
	if (!target) {
		return { error: 'Invalid torrent ID', status: 400 };
	}

	const lookup = {
		webdl: getWebDownloadList,
		usenet: getUsenetList,
		torrent: getTorrentList,
	}[target.kind];
	const result = await lookup(profile.apiKey, { id: target.id });
	if (!result.success || !result.data) {
		return { error: 'Failed to get torrent info', status: 500 };
	}

	const item = asList<TorBoxTorrentInfo | TorBoxWebDownload | TorBoxUsenetDownload>(
		result.data
	)[0];
	if (!item || !item.download_finished || !item.download_present) {
		return { error: 'Torrent not found', status: 404 };
	}

	const metaId = `dmm-tb:${entryId}`;
	const videos = (item.files || []).map((file) => ({
		id: `${metaId}:${file.id}`,
		title: `${file.short_name || file.name} - ${((file.size || 0) / 1024 / 1024 / 1024).toFixed(2)} GB`,
		streams: [
			{
				url: `${process.env.DMM_ORIGIN}/api/stremio-tb/${userid}/play/${entryId}:${file.id}`,
				behaviorHints: {
					bingeGroup: metaId,
				},
			},
		],
	}));

	// Sort videos by title
	videos.sort((a, b) => a.title.localeCompare(b.title));

	const totalSize = (item.files || []).reduce((sum, f) => sum + (f.size || 0), 0);

	return {
		data: {
			meta: {
				id: metaId,
				type: 'other',
				name: `DMM TB: ${item.name} - ${(totalSize / 1024 / 1024 / 1024).toFixed(2)} GB`,
				videos,
				...(target.kind === 'torrent'
					? await libraryArtFor((item as TorBoxTorrentInfo).hash)
					: {}),
			},
			cacheMaxAge: 0,
		},
		status: 200,
	};
}
