import { openApiDocument } from '@/utils/openapi';
import type { NextApiRequest, NextApiResponse } from 'next';

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('Cache-Control', 'public, s-maxage=3600');
	return res.status(200).json(openApiDocument);
}
