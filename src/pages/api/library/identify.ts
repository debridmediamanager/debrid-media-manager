import { identifyFilenames } from '@/services/contentIdentifier';
import type { FilenameIdentification } from '@/services/database/hashImdb';
import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { repository } from '@/services/repository';
import type { LibraryIdentification } from '@/utils/libraryIdentify';
import { createHash } from 'crypto';
import type { NextApiRequest, NextApiResponse } from 'next';

export const MAX_ITEMS = 500;
const MAX_FILENAME = 512;
const INFO_HASH = /^[a-f0-9]{40}$/;

interface Item {
	hash: string | null;
	filename: string;
	titleKey: string;
}

function parseItems(body: unknown): Item[] | null {
	const items = (body as { items?: unknown } | undefined)?.items;
	if (!Array.isArray(items) || items.length === 0 || items.length > MAX_ITEMS) return null;
	const out: Item[] = [];
	for (const item of items) {
		const { hash, filename } = (item ?? {}) as { hash?: unknown; filename?: unknown };
		if (typeof filename !== 'string' || !filename.trim()) return null;
		if (hash !== undefined && hash !== null && typeof hash !== 'string') return null;
		const name = filename.trim().slice(0, MAX_FILENAME);
		const lower = typeof hash === 'string' ? hash.toLowerCase() : '';
		out.push({
			hash: INFO_HASH.test(lower) ? lower : null,
			filename: name,
			titleKey: createHash('sha1').update(name).digest('hex'),
		});
	}
	return out;
}

/**
 * Which movie each library release is, named from its filename by
 * content-identifier. Answers already stored for a hash+filename pair are served
 * from HashIdentification; the rest are asked of the service and stored. Only
 * confident answers are returned, so a row shows a title only when it is right
 * about 98% of the time. Hashless releases (Premiumize, Offcloud URLs) are
 * identified but not stored.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST') {
		res.setHeader('Allow', 'POST');
		return res.status(405).json({ error: 'Method not allowed' });
	}
	const items = parseItems(req.body);
	if (!items) {
		return res.status(400).json({
			error: `Expected {"items": [{"filename": string, "hash"?: string}]} with 1-${MAX_ITEMS} items`,
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
		const known = (i: Item) => (i.hash ? stored.get(`${i.hash}|${i.titleKey}`) : undefined);

		const missing = [...new Set(items.filter((i) => !known(i)).map((i) => i.filename))];
		const answers = missing.length ? await identifyFilenames(missing) : [];
		const fresh = new Map(answers ? missing.map((name, n) => [name, answers[n]]) : []);

		const toStore: FilenameIdentification[] = [];
		const results = items.map((item): LibraryIdentification | null => {
			const row = known(item);
			if (row) {
				return row.confident && row.imdbId
					? { imdbId: row.imdbId, title: row.title ?? '', year: row.year }
					: null;
			}
			const answer = fresh.get(item.filename);
			if (!answer) return null;
			const top = answer.matches[0];
			if (item.hash) {
				toStore.push({
					hash: item.hash,
					titleKey: item.titleKey,
					filename: item.filename,
					imdbId: top?.imdbId ?? null,
					title: top?.title.slice(0, 500) ?? null,
					year: top?.year ?? null,
					score: top?.score ?? null,
					confident: Boolean(top && answer.confident),
				});
			}
			return top && answer.confident
				? { imdbId: top.imdbId, title: top.title, year: top.year }
				: null;
		});

		// a failed write costs only a repeat question next time, never the answer
		repository
			.saveFilenameIdentifications(dedupe(toStore))
			.catch((error) => console.error('Failed to store library identifications', error));

		return res
			.status(200)
			.json({ results, complete: missing.length === 0 || answers !== null });
	} catch (error) {
		console.error('Failed to identify library filenames', error);
		return res.status(500).json({ error: 'Internal server error' });
	}
}

/** One row per hash+filename; a library can list the same release twice. */
function dedupe(rows: FilenameIdentification[]): FilenameIdentification[] {
	return [...new Map(rows.map((r) => [`${r.hash}|${r.titleKey}`, r])).values()];
}

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.libraryIdentify);
