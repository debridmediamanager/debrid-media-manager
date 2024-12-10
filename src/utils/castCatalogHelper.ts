import { Repository } from '@/services/planetscale';
import { getToken, getTorrentInfo, getUserTorrentsList } from '@/services/realDebrid';

const db = new Repository();
export const PAGE_SIZE = 12;

export async function getDMMLibrary(userid: string, page: number) {
	const profile = await db.getCastProfile(userid);
	if (!profile) {
		return { error: 'Go to DMM and connect your RD account', status: 401 };
	}

	const response = await getToken(
		profile.clientId,
		profile.clientSecret,
		profile.refreshToken,
		false
	);
	if (!response) {
		return { error: 'Go to DMM and connect your RD account', status: 500 };
	}

	const results = await getUserTorrentsList(response.access_token, PAGE_SIZE, page, true);
	if (!results) {
		return { error: 'Failed to get user torrents list', status: 500 };
	}

	let hasMore = false;
	if (results.totalCount) {
		const skip = (page - 1) * PAGE_SIZE;
		hasMore = skip + PAGE_SIZE < results.totalCount;
	}

	return {
		data: {
			metas: results.data.map((torrent) => ({
				id: `dmm:${torrent.id}`,
				name: torrent.filename,
				type: 'other',
			})),
			hasMore,
			cacheMaxAge: 0,
		},
		status: 200,
	};
}

export async function getDMMTorrent(userid: string, torrentID: string) {
	const profile = await db.getCastProfile(userid);
	if (!profile) {
		return { error: 'Go to DMM and connect your RD account', status: 401 };
	}

	const response = await getToken(
		profile.clientId,
		profile.clientSecret,
		profile.refreshToken,
		false
	);
	if (!response) {
		return { error: 'Go to DMM and connect your RD account', status: 500 };
	}

	const info = await getTorrentInfo(response.access_token, torrentID, true);
	if (!info) {
		return { error: 'Failed to get torrent info', status: 500 };
	}

	const selectedFiles = info.files.filter((file) => file.selected);
	if (selectedFiles.length !== info.links.length) {
		return { error: 'Torrent is no longer cached', status: 404 };
	}
	const videos = selectedFiles.map((file, idx) => ({
		id: `dmm:${torrentID}:${file.id}`,
		title: `${file.path.split('/').pop()} - ${(file.bytes / 1024 / 1024 / 1024).toFixed(2)} GB`,
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
				name: `DMM: ${info.original_filename} - ${(info.original_bytes / 1024 / 1024 / 1024).toFixed(2)} GB`,
				videos,
			},
			cacheMaxAge: 0,
		},
		status: 200,
	};
}
