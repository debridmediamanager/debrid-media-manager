import { castNoticeMeta, sendForeignMeta, sendNoticeMeta } from '@/utils/castAddonResponses';
import { NextApiRequest, NextApiResponse } from 'next';

// Only this addon's notice tiles live here: Easynews has no library to open.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');
	if (req.method === 'OPTIONS') {
		return res.status(200).end();
	}
	const { id } = req.query;
	const notice = typeof id === 'string' ? castNoticeMeta('en', id.replace(/\.json$/, '')) : null;
	if (notice) {
		sendNoticeMeta(res, notice);
		return;
	}
	sendForeignMeta(res);
}
