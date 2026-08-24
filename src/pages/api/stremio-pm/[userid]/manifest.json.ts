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
	resources: [{ name: 'stream', types: ['movie', 'series'], idPrefixes: ['tt'] }],
	types: withCatalogs ? ['movie', 'series'] : ['movie', 'series'],
	catalogs: withCatalogs
		? [
				{ id: 'pm-casted-movies', name: 'DMM PM Movies', type: 'movie' },
				{ id: 'pm-casted-shows', name: 'DMM PM TV Shows', type: 'series' },
			]
		: [],
	behaviorHints: { adult: false, p2p: false },
});

export default async function handler(_req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');
	res.status(200).json(premiumizeCastManifest(true));
}
