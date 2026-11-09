import {
	EasynewsAuthError,
	EasynewsNzbError,
	isEasynewsPath,
	readCredentials,
	splitEasynewsPath,
} from '@/services/easynews';
import { fetchCleanEasynewsNzb, storeEasynewsNzb } from '@/services/easynewsNzbLibrary';
import { isStoreConfigured } from '@/services/newznab/store';
import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { BLOCKED_MESSAGE } from '@/services/takedown/blocklist';
import { nzbAttachment, safeNzbName } from '@/utils/nzbName';
import { NzbSanitizeError } from '@/utils/nzbSanitize';
import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * "Download NZB" on an Easynews row: that result's NZB, fetched with the caller's
 * own login and rebuilt like the indexer rows' download, for their own SABnzbd or
 * NZBGet. Body: `{username, password, path, sig, size?, imdbId?, kind?}`. With the
 * title it is also kept for the title's Usenet table, as Send to zurg keeps it.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		res.setHeader('Allow', 'POST');
		return res.status(405).json({ error: 'Method not allowed' });
	}
	const credentials = readCredentials(req.body);
	if (!credentials) {
		return res.status(400).json({ error: 'Easynews username and password are required' });
	}
	const { path, sig, size, imdbId, kind } = (req.body ?? {}) as Record<string, unknown>;
	if (!isEasynewsPath(path)) {
		return res.status(400).json({ error: 'path must be an Easynews result path' });
	}
	// Without the search row's sig Easynews answers an empty NZB.
	if (typeof sig !== 'string' || !sig || sig.length > 512) {
		return res.status(400).json({ error: 'Easynews did not hand out this NZB; search again' });
	}

	let cleaned;
	try {
		cleaned = await fetchCleanEasynewsNzb(credentials, path, sig);
	} catch (error) {
		if (error instanceof EasynewsAuthError) {
			return res.status(401).json({ error: error.message });
		}
		if (error instanceof EasynewsNzbError || error instanceof NzbSanitizeError) {
			return res.status(422).json({ error: error.message });
		}
		// The message never carries the login or the sig: fetchEasynewsNzb names only the status.
		console.error('Easynews NZB download failed:', error);
		return res.status(502).json({ error: 'Easynews did not hand out the NZB' });
	}
	if (!cleaned) return res.status(451).json({ error: BLOCKED_MESSAGE });

	if (
		typeof imdbId === 'string' &&
		/^tt\d{7,}$/.test(imdbId) &&
		(kind === 'movie' || kind === 'show') &&
		isStoreConfigured()
	) {
		void storeEasynewsNzb(path, cleaned.xml, { imdbId, kind, size }).catch((error) =>
			console.error(
				'Easynews NZB save failed:',
				error instanceof Error ? error.message : error
			)
		);
	}

	res.setHeader('Cache-Control', 'private, no-store');
	res.setHeader('X-Nzb-Removed', cleaned.removed.join('; ').replace(/[^\x20-\x7e]/g, '') || '-');
	res.setHeader('Content-Type', 'application/x-nzb; charset=utf-8');
	res.setHeader('Content-Disposition', nzbAttachment(safeNzbName(splitEasynewsPath(path).name)));
	return res.status(200).send(cleaned.xml);
}

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.default);
