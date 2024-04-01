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
	const streamUrls = await db.getCastURLs(imdbidStr, userid as string);
	for (const url of streamUrls) {
		let title = url.split('/').pop() ?? 'Unknown Title';
		title = decodeURIComponent(title) + '\n' + url;
		streams.push({
			name: 'DMM⚔️',
			title,
			url,
		});
	}

	res.setHeader('access-control-allow-origin', '*');
	res.status(200).json({ streams });
}
