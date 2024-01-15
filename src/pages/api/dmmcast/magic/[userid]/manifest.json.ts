import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');
	res.status(200).json({
		id: 'com.debridmediamanager.cast',
		name: 'DMM Cast',
		description:
			'Cast your preferred Debrid Media Manager streams to your Stremio device; Only supports Movies for now, TV Shows coming soon!',
		logo: 'https://static.debridmediamanager.com/dmmcast.png',
		background: 'https://static.debridmediamanager.com/background.png',
		version: '0.0.1',
		resources: ['stream'],
		types: ['movie'],
		idPrefixes: ['tt'],
		catalogs: [],
		behaviorHints: { adult: false, p2p: false },
	});
}
