import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	const host = req.headers.host || '';
	const isDev = !host.includes('debridmediamanager.com');
	const name = isDev ? '[LOCAL] DMM Cast for Torrin (No Library)' : 'DMM Cast for Torrin';

	res.setHeader('access-control-allow-origin', '*');
	res.status(200).json({
		id: 'com.debridmediamanager.cast.torrin',
		name,
		description:
			'Cast your preferred Debrid Media Manager streams to your Stremio device using Torrin; supports Anime, TV shows and Movies!',
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
		catalogs: [],
		behaviorHints: { adult: false, p2p: false },
	});
}
