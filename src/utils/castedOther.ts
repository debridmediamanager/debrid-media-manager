import { PlanetScaleCache } from '@/services/planetscale';
import { getToken, getUserTorrentsList } from '@/services/realDebrid';

const db = new PlanetScaleCache();
export const PAGE_SIZE = 12;

export async function getCastedOtherMetas(userid: string, page: number) {
	const profile = await db.getCastProfile(userid);
	if (!profile) {
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
