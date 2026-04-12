import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	const host = req.headers.host || '';
	const isDev = !host.includes('debridmediamanager.com');
	const name = isDev ? '[LOCAL] DMM Cast for TorBox (No Library)' : 'DMM Cast for TorBox';

	res.setHeader('access-control-allow-origin', '*');
	res.status(200).json({
		id: 'com.debridmediamanager.cast.torbox',
		name,
		description:
			'Cast your preferred Debrid Media Manager streams to your Stremio device using TorBox; supports Anime, TV shows and Movies!',
		logo: 'https://static.debridmediamanager.com/dmmcast.png',
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
				id: 'tb-casted-movies',
				name: 'DMM TB Movies',
				type: 'movie',
			},
			{
				id: 'tb-casted-shows',
				name: 'DMM TB TV Shows',
				type: 'series',
			},
		],
		behaviorHints: { adult: false, p2p: false },
	});
}
