import {
	type ModelFilter,
	type ReportDecisionKind,
	type ReportPair,
	ReportService,
} from '@/services/database/report';
import { ScrapedVerdictService } from '@/services/database/scrapedVerdict';
import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { isModelReporter, JEV_DISPUTED, JEV_REPORTER } from '@/services/reporterId';
import { getSiteSetting } from '@/services/siteSettings';
import { isAdmin } from '@/utils/adminToken';
import { NextApiHandler } from 'next';

// The report review queue for /admin/reports. A release is hidden on a title only once
// it is approved here. GET lists a page of one status; POST approves, dismisses or puts
// a pair back in the queue.

export const REPORTS_PAGE_SIZE = 25;
const STATUSES = ['pending', 'approved', 'dismissed'] as const;
type Status = (typeof STATUSES)[number];
const ACTIONS = { approve: 'approved', dismiss: 'dismissed' } as const;
const MODEL_FILTERS: ModelFilter[] = ['all', 'agrees', 'disagrees', 'unjudged'];

export type AdminReport = ReportPair & {
	/** IMDb's primary title, year and kind; null when IMDb has no row for the id. */
	title: string | null;
	year: number | null;
	kind: 'movie' | 'show' | null;
	/** The release name DMM has for this hash on this title, if it still has one. */
	filename: string | null;
	/** For a show, the season pages listing the release. */
	seasons: number[];
	types: string[];
	/** Distinct people who reported it. */
	reporters: number;
	/** The verdict model's view of the report. A hint, never a decision; null = not judged. */
	model: 'agrees' | 'disagrees' | null;
	lastReportedAt: string;
	decision: ReportDecisionKind | null;
	note: string | null;
	decidedAt: string | null;
};

const IMDB_ID = /^tt\d{1,12}$/;
const HASH = /^[0-9a-z]{32,64}$/;

export type InspectedFile = { path: string; size: number; link: string; streamLink: string | null };

/**
 * A reported torrent's files and playable links, from Premiumize's directdl: it
 * answers for cached torrents only and adds nothing to the account. The links are
 * short-lived CDN URLs for the admin who asked.
 */
async function inspect(hash: string): Promise<[number, unknown]> {
	const key = await getSiteSetting('inspectPremiumizeKey');
	if (!key) {
		return [
			503,
			{ error: 'Set the Premiumize key under Site settings to look inside releases' },
		];
	}
	let answer: {
		status?: string;
		content?: { path: string; size?: number; link: string; stream_link?: string | null }[];
	};
	try {
		const response = await fetch('https://www.premiumize.me/api/transfer/directdl', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${key}`,
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams({ src: `magnet:?xt=urn:btih:${hash}` }),
			signal: AbortSignal.timeout(30_000),
		});
		answer = await response.json();
	} catch {
		return [502, { error: 'Premiumize did not answer' }];
	}
	if (answer.status !== 'success') return [200, { cached: false, files: [] }];
	const files: InspectedFile[] = (answer.content ?? [])
		.map((file) => ({
			path: file.path,
			size: file.size ?? 0,
			link: file.link,
			streamLink: file.stream_link ?? null,
		}))
		.sort((a, b) => b.size - a.size);
	return [200, { cached: true, files }];
}

let reports: ReportService | null = null;
let scraped: ScrapedVerdictService | null = null;

async function describe(
	pairs: (ReportPair & Partial<Pick<AdminReport, 'decision' | 'note'>> & { decidedAt?: Date })[]
): Promise<AdminReport[]> {
	const [filed, titles] = await Promise.all([
		reports!.getReportsFor(pairs),
		reports!.getTitles(pairs.map((pair) => pair.imdbId)),
	]);
	const byTitle = new Map<string, string[]>();
	for (const { imdbId, hash } of pairs)
		byTitle.set(imdbId, [...(byTitle.get(imdbId) ?? []), hash]);
	const listings = new Map<string, { title: string; seasons: number[] }>();
	await Promise.all(
		[...byTitle].map(async ([imdbId, hashes]) => {
			const found = await scraped!.getListings(imdbId, hashes).catch(() => new Map());
			for (const [hash, listing] of found) listings.set(`${imdbId}:${hash}`, listing);
		})
	);
	return pairs.map((pair) => {
		const mine = filed.filter((r) => r.imdbId === pair.imdbId && r.hash === pair.hash);
		const people = mine.filter((r) => !isModelReporter(r.userId));
		const last = Math.max(0, ...mine.map((r) => r.createdAt.getTime()));
		return {
			imdbId: pair.imdbId,
			hash: pair.hash,
			title: titles.get(pair.imdbId)?.title ?? null,
			year: titles.get(pair.imdbId)?.year ?? null,
			kind: titles.get(pair.imdbId)?.kind ?? null,
			filename: listings.get(`${pair.imdbId}:${pair.hash}`)?.title ?? null,
			seasons: listings.get(`${pair.imdbId}:${pair.hash}`)?.seasons ?? [],
			types: [...new Set(mine.map((r) => r.type))].sort(),
			reporters: new Set(people.map((r) => r.userId)).size,
			model: mine.some((r) => r.userId === JEV_REPORTER)
				? 'agrees'
				: mine.some((r) => r.userId === JEV_DISPUTED)
					? 'disagrees'
					: null,
			lastReportedAt: new Date(last).toISOString(),
			decision: pair.decision ?? null,
			note: pair.note ?? null,
			decidedAt: pair.decidedAt ? pair.decidedAt.toISOString() : null,
		};
	});
}

const handler: NextApiHandler = async (req, res) => {
	if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
	res.setHeader('Cache-Control', 'no-store');
	reports ??= new ReportService();
	scraped ??= new ScrapedVerdictService();

	if (req.method === 'GET') {
		const status: Status = STATUSES.find((s) => s === req.query.status) ?? 'pending';
		const page = Math.max(0, Math.min(10_000, Number(req.query.page) || 0));
		const skip = page * REPORTS_PAGE_SIZE;
		if (status === 'pending') {
			const model = MODEL_FILTERS.find((f) => f === req.query.model) ?? 'all';
			const [{ total, pairs }, counts] = await Promise.all([
				reports.listUndecidedReports(REPORTS_PAGE_SIZE, skip, model),
				reports.countUndecidedByModel(),
			]);
			return res.status(200).json({ total, counts, items: await describe(pairs) });
		}
		const { total, decisions } = await reports.listDecidedReports(
			status,
			REPORTS_PAGE_SIZE,
			skip
		);
		return res.status(200).json({ total, items: await describe(decisions) });
	}

	if (req.method !== 'POST') {
		res.setHeader('Allow', 'GET, POST');
		return res.status(405).json({ error: 'Method not allowed' });
	}
	const { imdbId, hash, action, note } = req.body ?? {};
	if (action === 'inspect') {
		if (typeof hash !== 'string' || !HASH.test(hash)) {
			return res.status(400).json({ error: 'hash is a lower-case infohash' });
		}
		const [code, body] = await inspect(hash);
		return res.status(code).json(body);
	}
	if (action === 'keepModelDisputed') {
		const kept = await reports.keepModelDisputed(
			'Kept in bulk: the model disagreed with every report'
		);
		return res.status(200).json({ kept });
	}
	if (typeof imdbId !== 'string' || !IMDB_ID.test(imdbId)) {
		return res.status(400).json({ error: 'imdbId is tt followed by digits' });
	}
	if (typeof hash !== 'string' || !HASH.test(hash)) {
		return res.status(400).json({ error: 'hash is a lower-case infohash' });
	}
	if (action === 'reopen') {
		await reports.undecide(imdbId, hash);
		return res.status(200).json({ ok: true });
	}
	if (action !== 'approve' && action !== 'dismiss') {
		return res.status(400).json({ error: 'action is approve, dismiss or reopen' });
	}
	if ((await reports.getReportsFor([{ imdbId, hash }])).length === 0) {
		return res.status(404).json({ error: 'Nobody reported that release on that title' });
	}
	const reviewNote = typeof note === 'string' && note.trim() ? note.trim().slice(0, 2000) : null;
	await reports.decide(imdbId, hash, ACTIONS[action as keyof typeof ACTIONS], reviewNote);
	return res.status(200).json({ ok: true });
};

export default withIpRateLimit(handler, RATE_LIMIT_CONFIGS.admin);
