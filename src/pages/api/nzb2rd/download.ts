import { fetchNzb } from '@/services/nzb2rd';
import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { safeNzbName } from '@/utils/nzbName';
import { NzbSanitizeError, sanitizeNzb } from '@/utils/nzbSanitize';
import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * Hands back one Usenet release as a clean NZB the caller can feed to their own
 * SABnzbd or NZBGet.
 *
 * Downloaded here rather than in the browser for the same reason a send is: the
 * indexer API key is a secret, and it rides in every `link` a search returns —
 * see the note at the top of services/nzb2rd.
 *
 * What comes back is not the indexer's file. It is rebuilt from the articles it
 * points at, dropping the indexer's per-download watermark along with everything
 * else neither reader needs (see utils/nzbSanitize). The articles themselves are
 * untouched, so the download is the same download.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'GET') {
		return res.status(405).json({ error: 'Method not allowed' });
	}

	const { id, title } = req.query;

	// The colon separates the indexer prefix from the native id (`ds:abc123`).
	if (typeof id !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(id)) {
		return res.status(400).json({ error: 'id must be an indexer result id' });
	}

	let raw: string;
	try {
		raw = await fetchNzb(id);
	} catch (error) {
		console.error('NZB download failed:', error);
		return res.status(502).json({ error: 'Could not download the NZB from the indexer' });
	}

	let cleaned;
	try {
		cleaned = sanitizeNzb(raw);
	} catch (error) {
		// A release the indexer still lists but can no longer serve articles for
		// comes back as a document with nothing in it. Saying which of the two
		// happened is the difference between "try another release" and "retry".
		if (error instanceof NzbSanitizeError) {
			console.error('NZB cleanup rejected the indexer response:', error.message);
			return res.status(502).json({ error: error.message });
		}
		throw error;
	}

	const name = safeNzbName(typeof title === 'string' && title.trim() ? title : id);

	// Readable by the fetch that asked for it, so the toast can say what came off
	// rather than claiming a clean-up that may have found nothing to do.
	res.setHeader('X-Nzb-Removed', cleaned.removed.join('; ').replace(/[^\x20-\x7e]/g, '') || '-');
	res.setHeader('Content-Type', 'application/x-nzb; charset=utf-8');
	res.setHeader(
		'Content-Disposition',
		`attachment; filename="${asciiFilename(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`
	);
	// The cleaned file is byte-identical for every caller, and each miss spends an
	// indexer grab from one shared account, so the edge is welcome to serve it.
	res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
	return res.status(200).send(cleaned.xml);
}

/**
 * The `filename` fallback for clients that ignore `filename*`. Quotes and
 * backslashes would end the parameter early, and a non-ASCII byte is undefined
 * behaviour there, so both are folded away.
 */
function asciiFilename(name: string): string {
	return name.replace(/[\\"]/g, '').replace(/[^\x20-\x7e]/g, '_');
}

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.nzbDownload);
