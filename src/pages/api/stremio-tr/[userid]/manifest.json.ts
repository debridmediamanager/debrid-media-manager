import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');
	res.status(200).json({
		id: 'com.debridmediamanager.cast.torrin',
		name: 'DMM Cast for Torrin',
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
			{
				name: 'meta',
				types: ['other'],
				idPrefixes: ['dmm-tr'],
			},
		],
		types: ['movie', 'series', 'other'],
		catalogs: [
			{
				id: 'tr-casted-movies',
				name: 'DMM TR Movies',
				type: 'movie',
			},
			{
				id: 'tr-casted-shows',
				name: 'DMM TR TV Shows',
				type: 'series',
			},
			{
				id: 'tr-casted-other',
				name: 'DMM TR Library',
				type: 'other',
				extra: [{ name: 'skip' }],
			},
		],
		behaviorHints: { adult: false, p2p: false },
	});
}
