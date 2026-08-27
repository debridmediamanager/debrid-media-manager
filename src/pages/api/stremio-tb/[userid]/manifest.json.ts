import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');
	res.status(200).json({
		id: 'com.debridmediamanager.cast.torbox',
		name: 'DMM Cast for TorBox',
		description:
			'Cast your preferred Debrid Media Manager streams to your Stremio device using TorBox; supports Anime, TV shows and Movies!',
		logo: 'https://static.debridmediamanager.com/dmmcast.png',
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
				idPrefixes: ['dmm-tb'],
			},
		],
		types: ['movie', 'series', 'other'],
		catalogs: [
			{
				id: 'tb-casted-movies',
				name: 'DMM TB Movies',
				type: 'movie',
				extra: [{ name: 'skip' }],
			},
			{
				id: 'tb-casted-shows',
				name: 'DMM TB TV Shows',
				type: 'series',
				extra: [{ name: 'skip' }],
			},
			{
				id: 'tb-casted-other',
				name: 'DMM TB Library',
				type: 'other',
				extra: [{ name: 'skip' }],
			},
		],
		behaviorHints: { adult: false, p2p: false },
	});
}
