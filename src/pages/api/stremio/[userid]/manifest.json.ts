import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');
	res.status(200).json({
		id: 'com.debridmediamanager.cast',
		name: 'DMM Cast for Real-Debrid',
		description:
			'Cast your preferred Debrid Media Manager streams to your Stremio device using Real-Debrid; supports Anime, TV shows and Movies!',
		logo: 'https://static.debridmediamanager.com/greenlogo.jpeg',
		background: 'https://static.debridmediamanager.com/background.png',
		version: '0.0.5',
		resources: [
			'catalog',
			{
				name: 'stream',
				types: ['movie', 'series'],
				idPrefixes: ['tt'],
			},
			{
				name: 'meta',
				types: ['other'],
				idPrefixes: ['dmm'],
			},
		],
		types: ['movie', 'series', 'other'],
		catalogs: [
			{
				id: 'casted-movies',
				name: 'DMM RD Movies',
				type: 'movie',
				extra: [{ name: 'skip' }],
			},
			{
				id: 'casted-shows',
				name: 'DMM RD TV Shows',
				type: 'series',
				extra: [{ name: 'skip' }],
			},
			{
				id: 'casted-other',
				name: 'DMM RD Library',
				type: 'other',
				extra: [{ name: 'skip' }],
			},
		],
		behaviorHints: { adult: false, p2p: false },
	});
}
