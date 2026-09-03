import { CAST_ADDON_VERSIONS } from '@/utils/castAddonVersions';
import { NextApiRequest, NextApiResponse } from 'next';

export const offcloudCastManifest = (withCatalogs: boolean) => ({
	id: withCatalogs
		? 'com.debridmediamanager.cast.offcloud'
		: 'com.debridmediamanager.cast.offcloud.nocatalog',
	name: withCatalogs ? 'DMM Cast for Offcloud' : 'DMM Cast for Offcloud (no catalog)',
	description:
		'Cast your preferred Debrid Media Manager streams to your Stremio device using Offcloud; supports Anime, TV shows and Movies!',
	logo: 'https://static.debridmediamanager.com/yellowlogo.jpeg',
	background: 'https://static.debridmediamanager.com/background.png',
	version: CAST_ADDON_VERSIONS.offcloud,
	resources: withCatalogs
		? [
				'catalog',
				{ name: 'stream', types: ['movie', 'series'], idPrefixes: ['tt'] },
				{ name: 'meta', types: ['other'], idPrefixes: ['dmm-oc'] },
			]
		: [{ name: 'stream', types: ['movie', 'series'], idPrefixes: ['tt'] }],
	types: withCatalogs ? ['movie', 'series', 'other'] : ['movie', 'series'],
	catalogs: withCatalogs
		? [
				{
					id: 'oc-casted-movies',
					name: 'DMM OC Movies',
					type: 'movie',
					extra: [{ name: 'skip' }],
				},
				{
					id: 'oc-casted-shows',
					name: 'DMM OC TV Shows',
					type: 'series',
					extra: [{ name: 'skip' }],
				},
				{
					id: 'oc-casted-other',
					name: 'DMM OC Library',
					type: 'other',
					extra: [{ name: 'skip' }],
				},
			]
		: [],
	behaviorHints: { adult: false, p2p: false },
});

export default async function handler(_req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');
	res.status(200).json(offcloudCastManifest(true));
}
