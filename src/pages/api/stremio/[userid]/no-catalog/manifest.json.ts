import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	const host = req.headers.host || '';
	const isDev = !host.includes('debridmediamanager.com');
	const name = isDev
		? '[LOCAL] DMM Cast for Real-Debrid (No Library)'
		: 'DMM Cast for Real-Debrid';

	res.setHeader('access-control-allow-origin', '*');
	res.status(200).json({
		id: 'com.debridmediamanager.cast',
		name,
		description:
			'Cast your preferred Debrid Media Manager streams to your Stremio device using Real-Debrid; supports Anime, TV shows and Movies!',
		logo: 'https://static.debridmediamanager.com/greenlogo.jpeg',
		background: 'https://static.debridmediamanager.com/background.png',
		version: '0.0.5',
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
				id: 'casted-movies',
				name: 'DMM RD Movies',
				type: 'movie',
			},
			{
				id: 'casted-shows',
				name: 'DMM RD TV Shows',
				type: 'series',
			},
		],
		behaviorHints: { adult: false, p2p: false },
	});
}
