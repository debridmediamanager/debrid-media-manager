import { PAGE_SIZE, getDebridLinkDMMLibrary } from '@/utils/debridLinkCastCatalogHelper';
import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');

	if (req.method === 'OPTIONS') {
		return res.status(200).end();
	}

	const { userid, skip } = req.query;
	if (typeof userid !== 'string' || typeof skip !== 'string') {
		res.status(400).json({
			status: 'error',
			errorMessage: 'Invalid "userid" or "skip" query parameter',
		});
		return;
	}

	// Stremio sends the extra as a path segment, not a query string:
	// `.../dl-casted-other/skip=24.json`. It is an item offset, not a page.
	const offset = Number.parseInt(skip.replace(/\.json$/, '').replace(/^skip=/, ''), 10);
	const page =
		Number.isSafeInteger(offset) && offset > 0 ? Math.floor(offset / PAGE_SIZE) + 1 : 1;

	try {
		const result = await getDebridLinkDMMLibrary(userid, page);
		if ('error' in result) {
			return res.status(result.status).json({ error: result.error });
		}
		res.status(result.status).json(result.data);
	} catch (error) {
		console.error(
			'Failed to get Debrid-Link library:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		res.status(500).json({ error: 'Failed to get Debrid-Link library' });
	}
}
