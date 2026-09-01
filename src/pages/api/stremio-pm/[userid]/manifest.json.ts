import { NextApiRequest, NextApiResponse } from 'next';

export const premiumizeCastManifest = (withCatalogs: boolean) => ({
	id: withCatalogs
		? 'com.debridmediamanager.cast.premiumize'
		: 'com.debridmediamanager.cast.premiumize.nocatalog',
	name: withCatalogs ? 'DMM Cast for Premiumize' : 'DMM Cast for Premiumize (no catalog)',
	description:
		'Cast your preferred Debrid Media Manager streams to your Stremio device using Premiumize; supports Anime, TV shows and Movies!',
	logo: 'https://static.debridmediamanager.com/yellowlogo.jpeg',
	background: 'https://static.debridmediamanager.com/background.png',
	version: '0.0.1',
	resources: withCatalogs
		? [
				'catalog',
				{ name: 'stream', types: ['movie', 'series'], idPrefixes: ['tt'] },
				{ name: 'meta', types: ['other'], idPrefixes: ['dmm-pm'] },
			]
		: [{ name: 'stream', types: ['movie', 'series'], idPrefixes: ['tt'] }],
	types: withCatalogs ? ['movie', 'series', 'other'] : ['movie', 'series'],
	catalogs: withCatalogs
		? [
				{
					id: 'pm-casted-movies',
					name: 'DMM PM Movies',
					type: 'movie',
					extra: [{ name: 'skip' }],
				},
				{
					id: 'pm-casted-shows',
					name: 'DMM PM TV Shows',
					type: 'series',
					extra: [{ name: 'skip' }],
				},
				{
					id: 'pm-casted-other',
					name: 'DMM PM Library',
					type: 'other',
					extra: [{ name: 'skip' }],
				},
			]
		: [],
	behaviorHints: { adult: false, p2p: false },
});

export default async function handler(_req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');
	res.status(200).json(premiumizeCastManifest(true));
}
