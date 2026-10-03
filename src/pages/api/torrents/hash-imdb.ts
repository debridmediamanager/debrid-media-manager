import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { repository } from '@/services/repository';
import type { NextApiRequest, NextApiResponse } from 'next';

// zurg sends its user's own dmm_api_key as x-zurg-token, so an active
// sponsor's key is the normal credential here. The shared secret is optional
// and prod has none: requiring it answered 500 to every zurg from January 2026.
async function isAuthorized(token: string | undefined): Promise<boolean> {
	if (!token) return false;
	const sharedSecret = process.env.ZURGTORRENT_SYNC_SECRET;
	if (sharedSecret && token === sharedSecret) return true;
	const sponsor = await repository.getSponsorByDmmApiKey(token);
	return Boolean(sponsor?.isSponsor);
}

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
	const authHeader = req.headers['x-zurg-token'];
	const token = Array.isArray(authHeader) ? authHeader[0] : authHeader;
	if (!(await isAuthorized(token))) {
		return res.status(401).json({ message: 'Unauthorized' });
	}

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
