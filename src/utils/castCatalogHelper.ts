import { RdTokenExpiredError, getTorrentInfo, getUserTorrentsList } from '@/services/realDebrid';
import { repository as db } from '@/services/repository';
import { retryDroppedConnection } from './castAddonFailure';
import { libraryArtFor, withLibraryArt } from './castLibraryArt';
import { castAccessToken } from './castRdToken';

export const PAGE_SIZE = 12;

/**
 * One page of the member's Real-Debrid library.
 *
 * A status in the result is a state the addon answers in its own words: 401
 * for a profile that is missing or holds no credential, 403 for a refresh
 * Real-Debrid refused. Anything Real-Debrid or the database throws past that
 * is left to propagate, so the route can tell a revoked key (401 `bad_token`)
 * from a dropped connection instead of answering both with a bare 500.
 */
export async function getDMMLibrary(userid: string, page: number) {
	const profile = await db.getCastProfile(userid);
	if (!profile) {
		return { error: 'Go to DMM and connect your RD account', status: 401 };
	}

	let accessToken: string | null = null;
	try {
		accessToken = await castAccessToken(profile);
	} catch (error) {
		if (error instanceof RdTokenExpiredError) {
			return {
				error: 'RD authorization expired. Re-authenticate at debridmediamanager.com/stremio',
				status: 403,
			};
		}
		throw error;
	}
	if (!accessToken) {
		return { error: 'Go to DMM and connect your RD account', status: 401 };
	}

	const token = accessToken;
	const results = await retryDroppedConnection(() =>
		getUserTorrentsList(token, PAGE_SIZE, page, true)
	);
	if (!results) {
		return { error: 'Failed to get user torrents list', status: 500 };
	}

	let hasMore = false;
	if (results.totalCount) {
		const skip = (page - 1) * PAGE_SIZE;
		hasMore = skip + PAGE_SIZE < results.totalCount;
	}

	const metas = await withLibraryArt(
		results.data.map((torrent) => ({
			meta: { id: `dmm:${torrent.id}`, name: torrent.filename, type: 'other' },
			hash: torrent.hash,
		}))
	);

	return {
		data: {
			metas,
			hasMore,
			cacheMaxAge: 0,
		},
		status: 200,
	};
}

/**
 * The meta for one library torrent: a video per selected file.
 *
 * Real-Debrid's own errors propagate. A torrent id this account does not hold
 * answers 404 `unknown_method`, which the route reads as "gone".
 */
export async function getDMMTorrent(userid: string, torrentID: string, token: string) {
	const info = await retryDroppedConnection(() => getTorrentInfo(token, torrentID, true));
	if (!info) {
		return { error: 'Failed to get torrent info', status: 500 };
	}

	const selectedFiles = info.files.filter((file) => file.selected);
	if (selectedFiles.length !== info.links.length) {
		// No link per file: the torrent is still downloading, or Real-Debrid
		// packed the selection into one archive because it held a file type it
		// will not stream (a subtitle beside the video is enough). Either way
		// the entry exists and has nothing to play, which is worth saying in
		// the meta rather than failing it - 38 of 62 RD library meta 500s in
		// one evening's logs were exactly this.
		return {
			data: {
				meta: {
					id: `dmm:${torrentID}`,
					type: 'other',
					name: `DMM RD: ${info.original_filename}`,
					description:
						info.status === 'downloaded'
							? 'Real-Debrid stored this torrent as an archive instead of one link per file, so there is nothing here to stream.'
							: `Real-Debrid has not finished this torrent yet (${info.status}). It becomes playable once it has.`,
					videos: [],
					...(await libraryArtFor(info.hash)),
				},
				cacheMaxAge: 0,
			},
			status: 200,
		};
	}
	const videos = selectedFiles.map((file, idx) => ({
		id: `dmm:${torrentID}:${file.id}`,
		title: `${file.path.startsWith('/') ? file.path.substring(1) : file.path} - ${(file.bytes / 1024 / 1024 / 1024).toFixed(2)} GB`,
		streams: [
			{
				url: `${process.env.DMM_ORIGIN}/api/stremio/${userid}/play/${info.links[idx].substring(26)}`,
				behaviorHints: {
					bingeGroup: `dmm:${torrentID}`,
				},
			},
		],
	}));
	// sort videos by title
	videos.sort((a, b) => a.title.localeCompare(b.title));

	return {
		data: {
			meta: {
				id: `dmm:${torrentID}`,
				type: 'other',
				name: `DMM RD: ${info.original_filename} - ${(info.original_bytes / 1024 / 1024 / 1024).toFixed(2)} GB`,
				videos,
				...(await libraryArtFor(info.hash)),
			},
			cacheMaxAge: 0,
		},
		status: 200,
	};
}
