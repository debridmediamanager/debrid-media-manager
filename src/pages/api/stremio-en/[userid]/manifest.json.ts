import { CAST_STREAM_RESOURCE } from '@/services/anime/stremioAnimeIds';
import { CAST_ADDON_VERSIONS } from '@/utils/castAddonVersions';
import { NextApiRequest, NextApiResponse } from 'next';

// No library catalog: Easynews keeps no per-account library to list. The meta
// resource only answers this addon's notice tiles (`dmm-en:notice:*`).
export const easynewsCastManifest = (withCatalogs: boolean) => ({
	id: withCatalogs
		? 'com.debridmediamanager.cast.easynews'
		: 'com.debridmediamanager.cast.easynews.nocatalog',
	name: withCatalogs ? 'DMM Cast for Easynews' : 'DMM Cast for Easynews (no catalog)',
	description:
		'Cast your preferred Debrid Media Manager streams to your Stremio device using Easynews; supports TV shows and Movies!',
	logo: 'https://static.debridmediamanager.com/yellowlogo.jpeg',
	background: 'https://static.debridmediamanager.com/background.png',
	version: CAST_ADDON_VERSIONS.easynews,
	resources: withCatalogs
		? [
				'catalog',
				CAST_STREAM_RESOURCE,
				{ name: 'meta', types: ['other'], idPrefixes: ['dmm-en'] },
			]
		: [CAST_STREAM_RESOURCE],
	types: withCatalogs ? ['movie', 'series', 'anime', 'other'] : ['movie', 'series', 'anime'],
	catalogs: withCatalogs
		? [
				{
					id: 'en-casted-movies',
					name: 'DMM EN Movies',
					type: 'movie',
					extra: [{ name: 'skip' }],
				},
				{
					id: 'en-casted-shows',
					name: 'DMM EN TV Shows',
					type: 'series',
					extra: [{ name: 'skip' }],
				},
			]
		: [],
	behaviorHints: { adult: false, p2p: false },
});

export default async function handler(_req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');
	res.status(200).json(easynewsCastManifest(true));
}
