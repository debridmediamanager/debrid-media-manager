import {
	identifyFilenames,
	refused,
	type IdentifierMatch,
	type IdentifierResult,
} from '@/services/contentIdentifier';
import type { FilenameIdentification } from '@/services/database/hashImdb';
import { cachedSources } from '@/services/placement';
import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { repository } from '@/services/repository';
import type { LibraryIdentification } from '@/utils/libraryIdentify';
import { validateOwnPageRequest } from '@/utils/ownPageRequest';
import { createHash } from 'crypto';
import type { NextApiRequest, NextApiResponse } from 'next';

export const MAX_ITEMS = 500;
const MAX_FILENAME = 512;
const INFO_HASH = /^[a-f0-9]{40}$/;
/** Older pages still say what they think an item is; the service now decides. */
const KINDS = ['movie', 'tv', 'auto'];

export interface IdentificationItem {
	hash: string | null;
	filename: string;
	titleKey: string;
}

function parseItems(body: unknown): IdentificationItem[] | null {
	const items = (body as { items?: unknown } | undefined)?.items;
	if (!Array.isArray(items) || items.length === 0 || items.length > MAX_ITEMS) return null;
	const out: IdentificationItem[] = [];
	for (const item of items) {
		const { hash, filename, kind } = (item ?? {}) as {
			hash?: unknown;
			filename?: unknown;
			kind?: unknown;
		};
		if (typeof filename !== 'string' || !filename.trim()) return null;
		if (kind !== undefined && !KINDS.includes(kind as string)) return null;
		if (hash !== undefined && hash !== null && typeof hash !== 'string') return null;
		out.push(identificationItem(filename, typeof hash === 'string' ? hash : null));
	}
	return out;
}

/** One release to identify, keyed as HashIdentification stores it. */
export function identificationItem(filename: string, hash: string | null): IdentificationItem {
	const name = filename.trim().slice(0, MAX_FILENAME);
	const lower = hash?.toLowerCase() ?? '';
	return {
		hash: INFO_HASH.test(lower) ? lower : null,
		filename: name,
		// "auto3:" since the guards below and the hash map's split rule: older answers
		// ("auto2:", "auto:", "tv:" or the bare name) were judged without them and are
		// never read again
		titleKey: createHash('sha1').update(`auto3:${name}`).digest('hex'),
	};
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
export async function identifyHandler(req: NextApiRequest, res: NextApiResponse) {
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
		return res.status(200).json(await identifyItems(items));
	} catch (error) {
		console.error('Failed to identify library filenames', error);
		return res.status(500).json({ error: 'Internal server error' });
	}
}

/**
 * `identifyHandler`'s answers for parsed items, one per item in order: null where nothing
 * is identified. `complete` is false when content-identifier could not be asked.
 */
export async function identifyItems(
	items: IdentificationItem[]
): Promise<{ results: (LibraryIdentification | null)[]; complete: boolean }> {
	const stored = new Map(
		(
			await repository.getFilenameIdentifications(
				items.flatMap((i) => (i.hash ? [{ hash: i.hash, titleKey: i.titleKey }] : []))
			)
		).map((row) => [`${row.hash}|${row.titleKey}`, row])
	);
	// by hash and name: a library can list one hash under several names
	const stale = new Set<string>();
	const known = (i: IdentificationItem) =>
		i.hash && !stale.has(`${i.hash}|${i.titleKey}`)
			? stored.get(`${i.hash}|${i.titleKey}`)
			: undefined;

	// a doubted answer the hash map has since come to back is asked again, so a
	// source that joins the map later reaches releases already stored
	// ponytail: one the year check still refuses is asked again on every visit;
	// store the parsed year if such rows ever become common
	const doubted = items.filter((i) => known(i)?.confident === false && known(i)?.imdbId);
	const backing = doubted.length
		? await repository.getHashTitleIds(doubted.map((i) => i.hash!))
		: new Map<string, Set<string>>();
	for (const i of doubted) {
		if (backing.get(i.hash!)?.has(known(i)!.imdbId!)) stale.add(`${i.hash}|${i.titleKey}`);
	}

	const missing = [...new Set(items.filter((i) => !known(i)).map((i) => i.filename))];
	const answers = missing.length ? await identifyFilenames(missing) : [];
	const fresh = new Map<string, IdentifierResult>(
		answers ? missing.map((name, n) => [name, answers[n]]) : []
	);
	await Promise.all(
		[...fresh].map(async ([name, answer]) => {
			// a short answer from the service leaves names without one
			const twin = answer && (await knownTwin(answer));
			if (twin) {
				const rest = answer.matches.filter((m) => m !== twin);
				fresh.set(name, { ...answer, confident: true, matches: [twin, ...rest] });
			}
		})
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
			top &&
				!refused(item.filename, answer) &&
				(answer.confident || (item.hash && agrees(answer, mapped.get(item.hash))))
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
		return confident ? { imdbId: top!.imdbId, title: top!.title, year: top!.year, kind } : null;
	});

	// a failed write costs only a repeat question next time, never the answer
	const asked = dedupe(toStore);
	repository
		.saveFilenameIdentifications(asked.filter((r) => !stale.has(`${r.hash}|${r.titleKey}`)))
		.catch((error) => console.error('Failed to store library identifications', error));
	const confirmed = asked.filter((r) => stale.has(`${r.hash}|${r.titleKey}`) && r.confident);
	if (confirmed.length) {
		repository
			.confirmFilenameIdentifications(confirmed)
			.catch((error) => console.error('Failed to confirm library identifications', error));
	}

	return { results, complete: missing.length === 0 || answers !== null };
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

/**
 * The match to take for a doubted answer whose leading matches all carry the name's own
 * title: IMDb lists Dragon Ball Z twice (1989, and the 1996 dub as tt0214341), which the
 * service ranks too close to be sure of, and TMDB's find knows only the first. Null unless
 * TMDB knows exactly one of them as the kind the service found.
 */
async function knownTwin(answer: IdentifierResult): Promise<IdentifierMatch | null> {
	const top = answer.matches[0];
	const letters = (text = '') => text.toLowerCase().replace(/[^a-z0-9]/g, '');
	if (answer.confident || !top || !answer.kind) return null;
	if (letters(top.title) !== letters(answer.parsedTitle)) return null;
	const leading = answer.matches.findIndex((m) => letters(m.title) !== letters(top.title));
	const twins = answer.matches.slice(0, leading === -1 ? undefined : leading);
	if (twins.length < 2) return null;
	const finds = await Promise.all(twins.map((m) => cachedSources.find(m.imdbId)));
	if (finds.some((found) => !found)) return null;
	const results = answer.kind === 'tv' ? 'tv_results' : 'movie_results';
	const known = twins.filter((_, n) => finds[n][results]?.length);
	return known.length === 1 ? known[0] : null;
}

/** One row per hash+filename; a library can list the same release twice. */
function dedupe(rows: FilenameIdentification[]): FilenameIdentification[] {
	return [...new Map(rows.map((r) => [`${r.hash}|${r.titleKey}`, r])).values()];
}

/** The library page's own route; tools call /api/sponsor/identify with their key. */
async function pageHandler(req: NextApiRequest, res: NextApiResponse) {
	if (!validateOwnPageRequest(req, res)) return;
	return identifyHandler(req, res);
}

export default withIpRateLimit(pageHandler, RATE_LIMIT_CONFIGS.libraryIdentify);
