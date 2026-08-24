import { isLegacyToken } from '@/utils/castApiHelpers';
import { getDMMLibrary, PAGE_SIZE } from '@/utils/castCatalogHelper';
import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	res.setHeader('access-control-allow-origin', '*');

	try {
		console.log('[casted-other/skip] Request received:', {
			userid: req.query.userid,
			skip: req.query.skip,
			url: req.url,
		});

		const { userid, skip } = req.query;
		if (typeof skip !== 'string') {
			console.log('[casted-other/skip] Invalid skip parameter:', skip);
			return res.status(400).json({ error: 'Invalid "skip" query parameter' });
		}

		const skipNum = skip.replaceAll(/^skip=/g, '').replaceAll(/\.json$/g, '');
		const page = Math.floor(Number(skipNum) / PAGE_SIZE) + 1;
		console.log('[casted-other/skip] Calculated page:', { skipNum, page });

		// Check for legacy 5-character token
		if (isLegacyToken(userid as string)) {
			console.log('[casted-other/skip] Legacy token detected:', userid);
			return res.status(200).json({
				metas: [
					{
						id: 'dmm:update-required',
						type: 'other',
						name: '⚠️ DMM Cast RD Update Required',
						description:
							'Please reinstall the addon from https://debridmediamanager.com/stremio\n\nYour casted content will be preserved.',
						poster: 'https://static.debridmediamanager.com/dmmcast.png',
					},
				],
			});
		}

		console.log('[casted-other/skip] Fetching library for user:', userid, 'page:', page);
		const result = await getDMMLibrary(userid as string, page);

		if ('error' in result) {
			console.log('[casted-other/skip] Library fetch error:', result);
			return res.status(result.status).json({ error: result.error });
		}

		console.log('[casted-other/skip] Success:', {
			status: result.status,
			metaCount: result.data.metas?.length,
		});
		res.status(result.status).json(result.data);
	} catch (error) {
		console.error('[casted-other/skip] Exception caught:', error);
		return res.status(500).json({
			// No stack: this is an addon endpoint any Stremio client can reach.
			error: 'Internal server error',
			message: error instanceof Error ? error.message : 'Unknown error',
		});
	}
}
