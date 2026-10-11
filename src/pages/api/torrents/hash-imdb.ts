import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { repository } from '@/services/repository';
import type { NextApiRequest, NextApiResponse } from 'next';

function isValidHash(value: string): boolean {
	return /^[a-fA-F0-9]{40}$/.test(value);
}

function isValidImdbId(value: string): boolean {
	return /^tt\d{7,}$/.test(value);
}

interface HashImdbInput {
	hash: string;
	imdbId: string;
}

function validatePairs(body: unknown): HashImdbInput[] | null {
	if (!body) return null;

	const items = Array.isArray(body) ? body : [body];

	if (items.length === 0 || items.length > 100) return null;

	const pairs: HashImdbInput[] = [];
	for (const item of items) {
		if (typeof item !== 'object' || item === null) return null;
		const hash =
			(item as Record<string, unknown>).hash ?? (item as Record<string, unknown>).Hash;
		const imdbId =
			(item as Record<string, unknown>).imdbId ??
			(item as Record<string, unknown>).ImdbId ??
			(item as Record<string, unknown>).IMDBID;

		if (typeof hash !== 'string' || typeof imdbId !== 'string') return null;
		if (!isValidHash(hash) || !isValidImdbId(imdbId)) return null;

		pairs.push({ hash, imdbId });
	}

	return pairs;
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
	// Any zurg may post, with or without a token, as with /api/torrents/snapshot:
	// most zurgs set no dmm_api_key. The shape check and the per-IP rate limit
	// are what keep junk out.
	const pairs = validatePairs(req.body);
	if (!pairs) {
		return res
			.status(400)
			.json({ message: 'Expected 1-100 items with valid hash and imdbId fields' });
	}

	try {
		const results = await repository.upsertHashImdbBatch(pairs);
		return res.status(201).json({ success: true, results });
	} catch (error) {
		console.error('Failed to persist hash-imdb mappings', error);
		return res.status(500).json({ message: 'Internal server error' });
	}
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method === 'POST') {
		return handlePost(req, res);
	}
	return res.status(405).json({ message: 'Method not allowed' });
}

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.hashImdb);
