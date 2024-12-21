import { getToken, getTorrentInfo, getUserTorrentsList } from '@/services/realDebrid';
import { Repository } from '@/services/repository';

const db = new Repository();
export const PAGE_SIZE = 12;

export async function getDMMLibrary(userid: string, page: number) {
	let profile: {
		clientId: string;
		clientSecret: string;
		refreshToken: string;
	} | null = null;
	try {
		profile = await db.getCastProfile(userid);
		if (!profile) {
			throw new Error(`no profile found for user ${userid}`);
		}
	} catch (error) {
		return { error: 'Go to DMM and connect your RD account', status: 401 };
	}

	const response = await getToken(
		profile.clientId,
		profile.clientSecret,
		profile.refreshToken,
		true
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

export async function getDMMTorrent(userid: string, torrentID: string, token: string) {
	const info = await getTorrentInfo(token, torrentID, true);
	if (!info) {
		return { error: 'Failed to get torrent info', status: 500 };
	}

	const selectedFiles = info.files.filter((file) => file.selected);
	if (selectedFiles.length !== info.links.length) {
		return {
			error: `Torrent is missing ${selectedFiles.length - info.links.length} files`,
			status: 500,
		};
	}
	const videos = selectedFiles.map((file, idx) => ({
		id: `dmm:${torrentID}:${file.id}`,
		title: `${file.path.split('/').pop()} - ${(file.bytes / 1024 / 1024 / 1024).toFixed(2)} GB`,
		streams: [
			{
				url: `${process.env.DMM_ORIGIN}/api/stremio/${userid}/play/${info.links[idx].substring(26)}?token=${token}`,
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
