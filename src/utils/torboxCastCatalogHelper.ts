import { repository as db } from '@/services/repository';
import { getTorrentList, getUsenetList, getWebDownloadList } from '@/services/torbox';
import { TorBoxTorrentInfo, TorBoxUsenetDownload, TorBoxWebDownload } from '@/services/types';
import { parseTorBoxCastTarget } from '@/utils/torboxWebDownload';

export const PAGE_SIZE = 12;

const asList = <T>(data: T[] | T | null | undefined): T[] =>
	!data ? [] : Array.isArray(data) ? data : [data];

async function getProfile(userid: string) {
	try {
		const profile = await db.getTorBoxCastProfile(userid);
		if (!profile) {
			throw new Error(`no profile found for user ${userid}`);
		}
		return profile;
	} catch (error) {
		return null;
	}
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
		...webDownloads.map((item) => ({
			id: `dmm-tb:w${item.id}`,
			name: item.name,
			type: 'other',
		})),
		...usenetDownloads.map((item) => ({
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
 * different tables and carry no comparable ordering. With the side-list count
 * `S` known, a page starting at `skip` takes `sideList[skip...]` and tops up
 * from torrent offset 0; once `skip >= S` the torrent offset is exactly
 * `skip - S`, which continues precisely where the straddling page stopped.
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
		const results = await getTorrentList(profile.apiKey, {
			offset: torrentOffset,
			limit: torrentLimit,
		});
		if (!results.success) {
			return { error: 'Failed to get user torrents list', status: 500 };
		}
		torrents = asList(results.data);
	}

	const metas = [
		...sideSlice,
		...torrents.map((torrent) => ({
			id: `dmm-tb:${torrent.id}`,
			name: torrent.name,
			type: 'other',
		})),
	];

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
		result.data as any
	)[0];
	if (!item) {
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
			},
			cacheMaxAge: 0,
		},
		status: 200,
	};
}
