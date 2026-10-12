import { identifyFilenames, type IdentifierResult } from '@/services/contentIdentifier';
import type { FilenameIdentification } from '@/services/database/hashImdb';
import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { repository } from '@/services/repository';
import type { LibraryIdentification } from '@/utils/libraryIdentify';
import { createHash } from 'crypto';
import type { NextApiRequest, NextApiResponse } from 'next';

export const MAX_ITEMS = 500;
const MAX_FILENAME = 512;
const INFO_HASH = /^[a-f0-9]{40}$/;
/** Older pages still say what they think an item is; the service now decides. */
const KINDS = ['movie', 'tv', 'auto'];

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
		const { hash, filename, kind } = (item ?? {}) as {
			hash?: unknown;
			filename?: unknown;
			kind?: unknown;
		};
		if (typeof filename !== 'string' || !filename.trim()) return null;
		if (kind !== undefined && !KINDS.includes(kind as string)) return null;
		if (hash !== undefined && hash !== null && typeof hash !== 'string') return null;
		const name = filename.trim().slice(0, MAX_FILENAME);
		const lower = typeof hash === 'string' ? hash.toLowerCase() : '';
		out.push({
			hash: INFO_HASH.test(lower) ? lower : null,
			filename: name,
			// answers from before the service chose movie or show are keyed by the bare
			// name (or "tv:" + name) and are never read again
			titleKey: createHash('sha1').update(`auto:${name}`).digest('hex'),
		});
	}
	return out;
}

/**
 * Which movie or show each library release is, named from its filename by
 * content-identifier, which also decides movie or show. Answers already stored
 * for a hash+filename pair are served from HashIdentification; the rest are
 * asked of the service and stored. A row gets a title when the service is
 * confident, or when the title it ranked first is the one DMM already maps the
 * release's hash to: two independent sources agreeing. Hashless releases
 * (Premiumize, Offcloud URLs) are identified but not stored.
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
		const fresh = new Map<string, IdentifierResult>(
			answers ? missing.map((name, n) => [name, answers[n]]) : []
		);

		const unsure = items.filter((i) => {
			const answer = fresh.get(i.filename);
			return i.hash && answer && !answer.confident && answer.matches[0];
		});
		const mapped = unsure.length
			? await repository.getHashTitleIds(unsure.map((i) => i.hash!))
			: new Map<string, Set<string>>();

		const toStore: FilenameIdentification[] = [];
		const results = items.map((item): LibraryIdentification | null => {
			const row = known(item);
			if (row) {
				return row.confident && row.imdbId
					? {
							imdbId: row.imdbId,
							title: row.title ?? '',
							year: row.year,
							kind: row.kind === 'tv' ? 'tv' : 'movie',
						}
					: null;
			}
			const answer = fresh.get(item.filename);
			if (!answer) return null;
			const top = answer.matches[0];
			const kind = answer.kind ?? 'movie';
			const confident = Boolean(
				top && (answer.confident || (item.hash && agrees(answer, mapped.get(item.hash))))
			);
			if (item.hash) {
				toStore.push({
					hash: item.hash,
					titleKey: item.titleKey,
					filename: item.filename,
					kind,
					imdbId: top?.imdbId ?? null,
					title: top?.title.slice(0, 500) ?? null,
					year: top?.year ?? null,
					score: answer.probability ?? top?.score ?? null,
					confident,
				});
			}
			return confident
				? { imdbId: top!.imdbId, title: top!.title, year: top!.year, kind }
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

/**
 * DMM maps the hash to the title the service ranked first, and the filename's year
 * does not contradict it. Measured on ymsita's library (2026-10-11), the year check
 * refuses `Pet.Sematary.2019...` ranked as Pet Sematary II (1992), a pairing a
 * mis-filed Available row also made, and cost no right answer.
 */
function agrees(answer: IdentifierResult, ids: Set<string> | undefined): boolean {
	const top = answer.matches[0];
	if (!top || !ids?.has(top.imdbId)) return false;
	const year = answer.parsedYear;
	return !(year && top.year && Math.abs(year - top.year) > 1);
}

/** One row per hash+filename; a library can list the same release twice. */
function dedupe(rows: FilenameIdentification[]): FilenameIdentification[] {
	return [...new Map(rows.map((r) => [`${r.hash}|${r.titleKey}`, r])).values()];
}

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.libraryIdentify);
