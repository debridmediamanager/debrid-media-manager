import { Repository } from '@/services/planetscale';
import { getToken } from '@/services/realDebrid';
import { NextApiRequest, NextApiResponse } from 'next';

const db = new Repository();

// lists all available streams for a movie or show
// note, addon prefix is /api/stremio/${userid}
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	const { userid, mediaType, imdbid } = req.query;

	if (typeof userid !== 'string' || typeof imdbid !== 'string' || typeof mediaType !== 'string') {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Invalid "userid", "imdbid" or "mediaType" query parameter',
		});
		return;
	}

	if (req.method === 'OPTIONS') {
		res.setHeader('access-control-allow-origin', '*');
		return res.status(200).end();
	}

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

	const imdbidStr = (imdbid as string).replace(/\.json$/, '');
	const typeSlug = mediaType === 'movie' ? 'movie' : 'show';
	let externalUrl = `${process.env.DMM_ORIGIN}/${typeSlug}/${imdbidStr}`;
	if (typeSlug === 'show') {
		// imdbidStr = imdbid:season:episode
		// externalUrl should be /show/imdbid/season
		const [imdbid2, season] = imdbidStr.split(':');
		externalUrl = `${process.env.DMM_ORIGIN}/${typeSlug}/${imdbid2}/${season}`;
	}
	const streams = [
		{
			name: '​1:Cast✨',
			title: 'Cast a file inside a torrent',
			externalUrl,
			behaviorHints: {
				bingeGroup: `dmm:${imdbidStr}:cast`,
			},
		},
		{
			name: '​2:Stream🪄',
			title: 'Stream the latest link you casted',
			url: `${process.env.DMM_ORIGIN}/api/stremio/${userid}/watch/${imdbidStr}/ping?token=${response.access_token}`,
			behaviorHints: {
				bingeGroup: `dmm:${imdbidStr}:stream`,
			},
		},
	];

	// get urls from db
	const [castItems, otherCastItems] = await Promise.all([
		db.getCastURLs(imdbidStr, userid),
		db.getOtherCastURLs(imdbidStr, userid),
	]);

	for (const item of castItems) {
		let title = item.url.split('/').pop() ?? 'Unknown Title';
		let sizeStr = '';
		if (item.size > 1024) {
			item.size = item.size / 1024;
			sizeStr = `${item.size.toFixed(2)} GB`;
		} else {
			sizeStr = `${item.size.toFixed(2)} MB`;
		}
		title = decodeURIComponent(title);
		if (title.length > 30) {
			const mid = title.length / 2;
			title = title.substring(0, mid) + '-\n' + title.substring(mid);
		}
		title = title + '\n' + `📦 ${sizeStr}`;
		streams.push({
			name: 'DMM 🧙‍♂️ Yours',
			title,
			url: item.link
				? `${process.env.DMM_ORIGIN}/api/stremio/${userid}/play/${item.link.substring(26)}?token=${response.access_token}`
				: item.url,
			behaviorHints: {
				bingeGroup: `dmm:${imdbidStr}:yours`,
			},
		});
	}

	const icons = ['🦄', '🐈'];
	otherCastItems.sort((a, b) => a.size - b.size);
	for (const item of otherCastItems) {
		let title = item.url.split('/').pop() ?? 'Unknown Title';
		let sizeStr = '';
		if (item.size > 1024) {
			item.size = item.size / 1024;
			sizeStr = `${item.size.toFixed(2)} GB`;
		} else {
			sizeStr = `${item.size.toFixed(2)} MB`;
		}
		title = decodeURIComponent(title);
		if (title.length > 30) {
			const mid = title.length / 2;
			title = title.substring(0, mid) + '-\n' + title.substring(mid);
		}
		title = title + '\n' + `📦 ${sizeStr}`;
		streams.push({
			name: `DMM ${icons.pop()} Other`,
			title,
			url: `${process.env.DMM_ORIGIN}/api/stremio/${userid}/play/${item.link.substring(26)}?token=${response.access_token}`,
			behaviorHints: {
				bingeGroup: `dmm:${imdbidStr}:other:${icons.length}`,
			},
		});
	}

	res.setHeader('access-control-allow-origin', '*');
	res.status(200).json({ streams });
}
