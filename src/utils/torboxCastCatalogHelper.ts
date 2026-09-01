import { repository as db } from '@/services/repository';
import { getTorrentList, getWebDownloadList } from '@/services/torbox';
import { TorBoxTorrentInfo, TorBoxWebDownload } from '@/services/types';
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
 * Every web download in the account.
 *
 * Unpaged on purpose: TorBox keeps web downloads in a table of its own whose
 * ids are unrelated to torrent ids, so there is no single offset that walks
 * both lists. Reading the short list whole is what makes the combined paging
 * below arithmetic instead of guesswork. Losing it must not cost the user their
 * torrents, so a failure degrades to an empty list - the same bargain the web
 * library strikes in `fetchTorrents`.
 */
async function fetchWebDownloads(apiKey: string): Promise<TorBoxWebDownload[]> {
	try {
		const response = await getWebDownloadList(apiKey);
		if (!response?.success) return [];
		return asList(response.data);
	} catch (error) {
		console.error(
			'[TorBox Library] web downloads unavailable:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		return [];
	}
}

/**
 * One page of the user's TorBox library: web downloads first, then torrents.
 *
 * The two lists are concatenated rather than interleaved because their ids come
 * from different tables and carry no comparable ordering. With the web download
 * count `W` known, a page starting at `skip` takes `webDownloads[skip...]` and
 * tops up from torrent offset 0; once `skip >= W` the torrent offset is exactly
 * `skip - W`, which continues precisely where the straddling page stopped.
 */
export async function getTorBoxDMMLibrary(userid: string, page: number) {
	const profile = await getProfile(userid);
	if (!profile) {
		return { error: 'Go to DMM and connect your TorBox account', status: 401 };
	}

	const skip = (page - 1) * PAGE_SIZE;
	const webDownloads = await fetchWebDownloads(profile.apiKey);

	const webSlice = webDownloads.slice(skip, skip + PAGE_SIZE);
	const torrentOffset = skip < webDownloads.length ? 0 : skip - webDownloads.length;
	const torrentLimit = PAGE_SIZE - webSlice.length;

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
		...webSlice.map((download) => ({
			id: `dmm-tb:w${download.id}`,
			name: download.name,
			type: 'other',
		})),
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
 * for a web download - the same shape the cast route already parses.
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

	const result = target.isWebDownload
		? await getWebDownloadList(profile.apiKey, { id: target.id })
		: await getTorrentList(profile.apiKey, { id: target.id });
	if (!result.success || !result.data) {
		return { error: 'Failed to get torrent info', status: 500 };
	}

	const item = asList<TorBoxTorrentInfo | TorBoxWebDownload>(result.data as any)[0];
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
