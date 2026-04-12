import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	const host = req.headers.host || '';
	const isDev = !host.includes('debridmediamanager.com');
	const name = isDev ? '[LOCAL] DMM Cast for AllDebrid (No Library)' : 'DMM Cast for AllDebrid';

	res.setHeader('access-control-allow-origin', '*');
	res.status(200).json({
		id: 'com.debridmediamanager.cast.alldebrid',
		name,
		description:
			'Cast your preferred Debrid Media Manager streams to your Stremio device using AllDebrid; supports Anime, TV shows and Movies!',
		logo: 'https://static.debridmediamanager.com/yellowlogo.jpeg',
		background: 'https://static.debridmediamanager.com/background.png',
		version: '0.0.1',
		resources: [
			{
				name: 'stream',
				types: ['movie', 'series'],
				idPrefixes: ['tt'],
			},
		],
		types: ['movie', 'series'],
		catalogs: [
			{
				id: 'ad-casted-movies',
				name: 'DMM AD Movies',
				type: 'movie',
			},
			{
				id: 'ad-casted-shows',
				name: 'DMM AD TV Shows',
				type: 'series',
			},
		],
		behaviorHints: { adult: false, p2p: false },
	});
}
