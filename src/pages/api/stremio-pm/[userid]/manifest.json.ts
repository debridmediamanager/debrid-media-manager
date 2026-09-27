import { CAST_STREAM_RESOURCE } from '@/services/anime/stremioAnimeIds';
import { CAST_ADDON_VERSIONS } from '@/utils/castAddonVersions';
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
	version: CAST_ADDON_VERSIONS.premiumize,
	resources: withCatalogs
		? [
				'catalog',
				CAST_STREAM_RESOURCE,
				{ name: 'meta', types: ['other'], idPrefixes: ['dmm-pm'] },
			]
		: [CAST_STREAM_RESOURCE],
	types: withCatalogs ? ['movie', 'series', 'anime', 'other'] : ['movie', 'series', 'anime'],
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
