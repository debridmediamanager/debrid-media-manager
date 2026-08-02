import { repository as db } from '@/services/repository';
import { getTorrinTorrentInfo, getTorrinTorrentsList } from '@/services/torrin';

export const PAGE_SIZE = 12;

export async function getTorrinDMMLibrary(userid: string, page: number) {
	let profile: { baseUrl: string; apiKey: string } | null = null;
	try {
		profile = await db.getTorrinCastProfile(userid);
		if (!profile) {
			throw new Error(`no profile found for user ${userid}`);
		}
	} catch (error) {
		return { error: 'Go to DMM and connect your Torrin instance', status: 401 };
	}

	let results;
	try {
		results = await getTorrinTorrentsList(profile.baseUrl, profile.apiKey, PAGE_SIZE, page);
	} catch (error) {
		return { error: 'Failed to fetch library from Torrin', status: 502 };
	}
	const torrents = results.data;
	const hasMore =
		results.totalCount != null
			? page * PAGE_SIZE < results.totalCount
			: torrents.length === PAGE_SIZE;

	return {
		data: {
			metas: torrents.map((torrent) => ({
				id: `dmm-tr:${torrent.id}`,
				name: torrent.filename,
				type: 'other',
			})),
			hasMore,
			cacheMaxAge: 0,
		},
		status: 200,
	};
}

export async function getTorrinDMMTorrent(userid: string, torrentID: string) {
	let profile: { baseUrl: string; apiKey: string } | null = null;
	try {
		profile = await db.getTorrinCastProfile(userid);
		if (!profile) {
			throw new Error(`no profile found for user ${userid}`);
		}
	} catch (error) {
		return { error: 'Go to DMM and connect your Torrin instance', status: 401 };
	}

	let torrent;
	try {
		torrent = await getTorrinTorrentInfo(profile.baseUrl, profile.apiKey, torrentID);
	} catch (error) {
		return { error: 'Failed to fetch torrent from Torrin', status: 502 };
	}
	if (!torrent) {
		return { error: 'Torrent not found', status: 404 };
	}

	const selectedFiles = torrent.files.filter((f) => f.selected);
	const videos = selectedFiles
		.map((file, idx) => {
			const link = torrent.links[idx];
			if (!link) return null;
			return {
				id: `dmm-tr:${torrentID}:${file.id}`,
				title: `${file.path.split('/').pop()} - ${((file.bytes || 0) / 1024 / 1024 / 1024).toFixed(2)} GB`,
				streams: [
					{
						url: `${process.env.DMM_ORIGIN}/api/stremio-tr/${userid}/play/${encodeURIComponent(link)}`,
						behaviorHints: {
							bingeGroup: `dmm-tr:${torrentID}`,
						},
					},
				],
			};
		})
		.filter((v): v is NonNullable<typeof v> => v !== null);

	videos.sort((a, b) => a.title.localeCompare(b.title));

	const totalSize = torrent.files.reduce((sum, f) => sum + (f.bytes || 0), 0);

	return {
		data: {
			meta: {
				id: `dmm-tr:${torrentID}`,
				type: 'other',
				name: `DMM TR: ${torrent.filename} - ${(totalSize / 1024 / 1024 / 1024).toFixed(2)} GB`,
				videos,
			},
			cacheMaxAge: 0,
		},
		status: 200,
	};
}
