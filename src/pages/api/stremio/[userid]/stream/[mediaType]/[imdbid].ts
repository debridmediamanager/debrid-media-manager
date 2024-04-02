import { PlanetScaleCache } from '@/services/planetscale';
import { NextApiRequest, NextApiResponse } from 'next';

const db = new PlanetScaleCache();

// note, addon prefix is /api/stremio/${userid}
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	const { userid, mediaType, imdbid } = req.query;

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
			name: 'Cast✨',
			title: 'Cast a file inside a torrent',
			externalUrl,
		},
		{
			name: 'Stream🪄',
			title: 'Stream the latest link you casted',
			url: `${process.env.DMM_ORIGIN}/api/stremio/${userid}/watch/${imdbidStr}/ping`,
		},
	];

	// get urls from db
	const castItems = await db.getCastURLs(imdbidStr, userid as string);
	for (const item of castItems) {
		let title = item.url.split('/').pop() ?? 'Unknown Title';
		let sizeStr = '';
		if (item.size > 1024) {
			item.size = item.size / 1024;
			sizeStr = `${item.size.toFixed(2)} GB`;
		} else {
			sizeStr = `${item.size.toFixed(2)} MB`;
		}
		title = decodeURIComponent(title) + '\n' + sizeStr;
		streams.push({
			name: 'DMM ⚔️',
			title,
			url: item.url,
		});
	}

	res.setHeader('access-control-allow-origin', '*');
	res.status(200).json({ streams });
}
