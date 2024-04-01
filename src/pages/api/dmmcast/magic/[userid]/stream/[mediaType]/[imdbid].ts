import { NextApiRequest, NextApiResponse } from 'next';

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
	res.setHeader('access-control-allow-origin', '*');
	res.status(200).json({
		streams: [
			{
				name: 'Cast✨',
				title: 'Choose a Torrent > Watch > Cast',
				externalUrl,
			},
			{
				name: 'Stream🪄',
				title: 'Stream the link you casted',
				url: `${process.env.DMM_ORIGIN}/api/dmmcast/magic/${userid}/watch/${imdbidStr}/ping`,
			},
		],
	});
}
