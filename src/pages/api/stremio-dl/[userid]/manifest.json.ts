import { CAST_ADDON_VERSIONS } from '@/utils/castAddonVersions';
import { NextApiRequest, NextApiResponse } from 'next';

export const debridLinkCastManifest = (withCatalogs: boolean) => ({
	id: withCatalogs
		? 'com.debridmediamanager.cast.debridlink'
		: 'com.debridmediamanager.cast.debridlink.nocatalog',
	name: withCatalogs ? 'DMM Cast for Debrid-Link' : 'DMM Cast for Debrid-Link (no catalog)',
	description:
		'Cast your preferred Debrid Media Manager streams to your Stremio device using Debrid-Link; supports Anime, TV shows and Movies!',
	logo: 'https://static.debridmediamanager.com/yellowlogo.jpeg',
	background: 'https://static.debridmediamanager.com/background.png',
	version: CAST_ADDON_VERSIONS.debridlink,
	resources: withCatalogs
		? [
				'catalog',
				{ name: 'stream', types: ['movie', 'series'], idPrefixes: ['tt'] },
				{ name: 'meta', types: ['other'], idPrefixes: ['dmm-dl'] },
			]
		: [{ name: 'stream', types: ['movie', 'series'], idPrefixes: ['tt'] }],
	types: withCatalogs ? ['movie', 'series', 'other'] : ['movie', 'series'],
	catalogs: withCatalogs
		? [
				{
					id: 'dl-casted-movies',
					name: 'DMM DL Movies',
					type: 'movie',
					extra: [{ name: 'skip' }],
				},
				{
					id: 'dl-casted-shows',
					name: 'DMM DL TV Shows',
					type: 'series',
					extra: [{ name: 'skip' }],
				},
				{
					id: 'dl-casted-other',
					name: 'DMM DL Library',
					type: 'other',
					extra: [{ name: 'skip' }],
				},
			]
		: [],
	behaviorHints: { adult: false, p2p: false },
});

export default async function handler(_req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');
	res.status(200).json(debridLinkCastManifest(true));
}
