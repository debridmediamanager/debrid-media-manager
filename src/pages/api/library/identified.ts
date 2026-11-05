import { parseItems, storedIdentification } from '@/pages/api/library/identify';
import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { repository } from '@/services/repository';
import { validateOwnPageRequest } from '@/utils/ownPageRequest';
import type { NextApiRequest, NextApiResponse } from 'next';

/** A shared list of 23,434 rows in five calls. */
export const MAX_CACHED_ITEMS = 5000;

// 5,000 real rows came to 643 KB at most (15 shared lists, 2026-11-05), near the 1 MB default
export const config = { api: { bodyParser: { sizeLimit: '4mb' } } };

/**
 * The answers /api/library/identify has already stored, and nothing more: the
 * identifier is never asked, so a hashlist page can name a whole list at once.
 * 15 shared lists sampled on 2026-11-05 had 51% of their 73,239 rows stored, read
 * in 1.6 s; the page asks the identifier only about the rows on screen.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		res.setHeader('Allow', 'POST');
		return res.status(405).json({ error: 'Method not allowed' });
	}
	if (!validateOwnPageRequest(req, res)) return;
	const items = parseItems(req.body, MAX_CACHED_ITEMS);
	if (!items) {
		return res.status(400).json({
			error: `Expected {"items": [{"filename": string, "hash": string}]} with 1-${MAX_CACHED_ITEMS} items`,
		});
	}

	try {
		const stored = new Map(
			(
				await repository.getFilenameIdentifications(
					items.flatMap((i) => (i.hash ? [{ hash: i.hash, titleKey: i.titleKey }] : []))
				)
			).map((row) => [`${row.hash}|${row.titleKey}`, row])
		);
		const results = items.map((i) => {
			const row = i.hash && stored.get(`${i.hash}|${i.titleKey}`);
			return row ? storedIdentification(row) : null;
		});
		return res.status(200).json({ results });
	} catch (error) {
		console.error('Failed to read stored identifications', error);
		return res.status(500).json({ error: 'Internal server error' });
	}
}

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.libraryIdentified);
