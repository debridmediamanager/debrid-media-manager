import {
	NewznabIndexerService,
	type NewznabIndexerInput,
	type NewznabIndexerRow,
} from '@/services/database/newznabIndexers';
import { getUpstreamIndexers, invalidateUpstreamIndexers } from '@/services/newznab/indexers';
import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { hasAdminToken } from '@/utils/adminToken';
import { NextApiHandler } from 'next';

// The Newznab aggregator's upstream indexers, for /newznab/admin. GET lists them,
// POST adds one, PATCH changes one. The token is NEWZNAB_ADMIN_TOKEN. API keys go
// in and never come back out: a response carries only their last three characters.

type Limit = { rateLimit: number; windowSeconds: number } | null;

export type AdminIndexer = {
	prefix: string;
	name: string;
	url: string;
	/** `…e08`, or '' when no key is stored. */
	keyHint: string;
	keyless: boolean;
	enabled: boolean;
	position: number;
	pacing: Limit;
	grabLimit: Limit;
};

const PREFIX = /^[a-z0-9]{1,16}$/;

const keyHint = (apiKey: string) =>
	apiKey.length >= 12 ? `…${apiKey.slice(-3)}` : apiKey ? '…' : '';

const limitOf = (rate: number | null, window: number | null): Limit =>
	rate && window ? { rateLimit: rate, windowSeconds: window } : null;

const view = (row: NewznabIndexerInput): AdminIndexer => ({
	prefix: row.prefix,
	name: row.name,
	url: row.url,
	keyHint: keyHint(row.apiKey),
	keyless: row.keyless,
	enabled: row.enabled,
	position: row.position,
	pacing: limitOf(row.pacingRate, row.pacingWindow),
	grabLimit: limitOf(row.grabRate, row.grabWindow),
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const isWhole = (value: unknown, min: number): value is number =>
	typeof value === 'number' && Number.isInteger(value) && value >= min && value <= 2_000_000_000;

/** `undefined` = leave as is, `null` = clear, else the limit; a string is the error. */
function readLimit(value: unknown, label: string): Limit | undefined | string {
	if (value === undefined) return undefined;
	if (value === null) return null;
	if (!isRecord(value) || !isWhole(value.rateLimit, 1) || !isWhole(value.windowSeconds, 1)) {
		return `${label} needs a whole number of requests and of seconds, both above 0`;
	}
	return { rateLimit: value.rateLimit, windowSeconds: value.windowSeconds };
}

/**
 * The body merged over `existing` (null for a new row), checked whole. A string
 * is the reason it was refused.
 */
export function mergeIndexerInput(
	body: unknown,
	existing: NewznabIndexerInput | null
): NewznabIndexerInput | string {
	if (!isRecord(body)) return 'Send a JSON object';
	const next: NewznabIndexerInput = existing
		? { ...existing }
		: {
				prefix: '',
				name: '',
				url: '',
				apiKey: '',
				keyless: false,
				enabled: true,
				position: 0,
				pacingRate: null,
				pacingWindow: null,
				grabRate: null,
				grabWindow: null,
			};

	if (!existing) {
		const prefix = typeof body.prefix === 'string' ? body.prefix.trim() : '';
		if (!PREFIX.test(prefix)) return 'The prefix is 1 to 16 lowercase letters or digits';
		next.prefix = prefix;
	}
	if (body.name !== undefined) {
		if (typeof body.name !== 'string') return 'The name must be text';
		next.name = body.name.trim();
	}
	if (!next.name || next.name.length > 100) return 'The name is 1 to 100 characters';

	if (body.url !== undefined) {
		if (typeof body.url !== 'string') return 'The URL must be text';
		next.url = body.url.trim().replace(/\/+$/, '');
	}
	let url: URL | null = null;
	try {
		url = new URL(next.url);
	} catch {}
	if (!url || !['http:', 'https:'].includes(url.protocol) || next.url.length > 512) {
		return 'The URL is the full http(s) API endpoint, e.g. https://example.com/api';
	}

	// An empty key keeps the stored one, so the form never has to hold it.
	if (body.apiKey !== undefined) {
		if (typeof body.apiKey !== 'string') return 'The API key must be text';
		const apiKey = body.apiKey.trim();
		if (apiKey.length > 255) return 'The API key is at most 255 characters';
		if (apiKey) next.apiKey = apiKey;
	}
	for (const flag of ['keyless', 'enabled'] as const) {
		if (body[flag] === undefined) continue;
		if (typeof body[flag] !== 'boolean') return `${flag} must be true or false`;
		next[flag] = body[flag] as boolean;
	}
	if (!next.apiKey && !next.keyless) {
		return 'An API key is required unless the indexer searches without one';
	}
	if (body.position !== undefined) {
		if (!isWhole(body.position, 0)) return 'The position is a whole number, 0 or more';
		next.position = body.position;
	}

	const pacing = readLimit(body.pacing, 'Search pacing');
	if (typeof pacing === 'string') return pacing;
	if (pacing !== undefined) {
		next.pacingRate = pacing?.rateLimit ?? null;
		next.pacingWindow = pacing?.windowSeconds ?? null;
	}
	const grabLimit = readLimit(body.grabLimit, 'The download limit');
	if (typeof grabLimit === 'string') return grabLimit;
	if (grabLimit !== undefined) {
		next.grabRate = grabLimit?.rateLimit ?? null;
		next.grabWindow = grabLimit?.windowSeconds ?? null;
	}
	return next;
}

const stored = ({ createdAt, updatedAt, ...row }: NewznabIndexerRow): NewznabIndexerInput => row;

let service: NewznabIndexerService | null = null;

const handler: NextApiHandler = async (req, res) => {
	if (!hasAdminToken(req, process.env.NEWZNAB_ADMIN_TOKEN)) {
		return res.status(401).json({ error: 'Unauthorized' });
	}
	res.setHeader('Cache-Control', 'no-store');
	service ??= new NewznabIndexerService();

	if (req.method === 'GET') {
		const rows = await service.listIndexers();
		if (rows.length > 0) {
			return res.status(200).json({ source: 'database', indexers: rows.map(view) });
		}
		// The table is empty, so the env list is what searches use; shown so the page
		// can say so before a first save replaces it.
		const fromEnv = getUpstreamIndexers().map((indexer, position) =>
			view({
				prefix: indexer.prefix,
				name: indexer.name,
				url: indexer.url,
				apiKey: indexer.apiKey,
				keyless: indexer.keyless === true,
				enabled: true,
				position,
				pacingRate: indexer.pacing?.rateLimit ?? null,
				pacingWindow: indexer.pacing?.windowSeconds ?? null,
				grabRate: indexer.grabLimit?.rateLimit ?? null,
				grabWindow: indexer.grabLimit?.windowSeconds ?? null,
			})
		);
		return res.status(200).json({ source: 'environment', indexers: fromEnv });
	}

	if (req.method !== 'POST' && req.method !== 'PATCH') {
		res.setHeader('Allow', 'GET, POST, PATCH');
		return res.status(405).json({ error: 'Method not allowed' });
	}

	const prefix = typeof req.body?.prefix === 'string' ? req.body.prefix.trim() : '';
	const existing = prefix ? await service.getIndexer(prefix) : null;
	if (req.method === 'POST' && existing) {
		// Taken, even by a disabled row: its release ids are still out there.
		return res.status(409).json({ error: `The prefix "${prefix}" is already taken` });
	}
	if (req.method === 'PATCH' && !existing) {
		return res.status(404).json({ error: 'No indexer has that prefix' });
	}

	const next = mergeIndexerInput(req.body, existing ? stored(existing) : null);
	if (typeof next === 'string') return res.status(400).json({ error: next });

	const { prefix: key, ...changes } = next;
	const row =
		req.method === 'POST'
			? await service.createIndexer(next)
			: await service.updateIndexer(key, changes);
	invalidateUpstreamIndexers();
	return res.status(req.method === 'POST' ? 201 : 200).json({ indexer: view(stored(row)) });
};

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.newznabIndexerAdmin);
