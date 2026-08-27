import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');
	res.status(200).json({
		id: 'com.debridmediamanager.cast.alldebrid',
		name: 'DMM Cast for AllDebrid',
		description:
			'Cast your preferred Debrid Media Manager streams to your Stremio device using AllDebrid; supports Anime, TV shows and Movies!',
		logo: 'https://static.debridmediamanager.com/yellowlogo.jpeg',
		background: 'https://static.debridmediamanager.com/background.png',
		version: '0.0.1',
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
				idPrefixes: ['dmm-ad'],
			},
		],
		types: ['movie', 'series', 'other'],
		catalogs: [
			{
				id: 'ad-casted-movies',
				name: 'DMM AD Movies',
				type: 'movie',
				extra: [{ name: 'skip' }],
			},
			{
				id: 'ad-casted-shows',
				name: 'DMM AD TV Shows',
				type: 'series',
				extra: [{ name: 'skip' }],
			},
			{
				id: 'ad-casted-other',
				name: 'DMM AD Library',
				type: 'other',
				extra: [{ name: 'skip' }],
			},
		],
		behaviorHints: { adult: false, p2p: false },
	});
}
