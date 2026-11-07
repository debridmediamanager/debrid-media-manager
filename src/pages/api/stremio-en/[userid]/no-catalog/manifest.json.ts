import { NextApiRequest, NextApiResponse } from 'next';
import { easynewsCastManifest } from '../manifest.json';

export default async function handler(_req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');
	res.status(200).json(easynewsCastManifest(false));
}
