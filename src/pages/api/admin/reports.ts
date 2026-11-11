import {
	type ReportDecisionKind,
	type ReportPair,
	ReportService,
} from '@/services/database/report';
import { ScrapedVerdictService } from '@/services/database/scrapedVerdict';
import { RATE_LIMIT_CONFIGS, withIpRateLimit } from '@/services/rateLimit/withRateLimit';
import { JEV_REPORTER } from '@/services/reporterId';
import { isAdmin } from '@/utils/adminToken';
import { NextApiHandler } from 'next';

// The report review queue for /admin/reports. A release is hidden on a title only once
// it is approved here. GET lists a page of one status; POST approves, dismisses or puts
// a pair back in the queue.

export const REPORTS_PAGE_SIZE = 25;
const STATUSES = ['pending', 'approved', 'dismissed'] as const;
type Status = (typeof STATUSES)[number];
const ACTIONS = { approve: 'approved', dismiss: 'dismissed' } as const;

export type AdminReport = ReportPair & {
	/** The release name DMM has for this hash on this title, if it still has one. */
	filename: string | null;
	types: string[];
	/** Distinct people who reported it. */
	reporters: number;
	/** The verdict model judged the report right. A hint, never a decision. */
	modelAgrees: boolean;
	lastReportedAt: string;
	decision: ReportDecisionKind | null;
	note: string | null;
	decidedAt: string | null;
};

const IMDB_ID = /^tt\d{1,12}$/;
const HASH = /^[0-9a-z]{32,64}$/;

let reports: ReportService | null = null;
let scraped: ScrapedVerdictService | null = null;

async function describe(
	pairs: (ReportPair & Partial<Pick<AdminReport, 'decision' | 'note'>> & { decidedAt?: Date })[]
): Promise<AdminReport[]> {
	const filed = await reports!.getReportsFor(pairs);
	const byTitle = new Map<string, string[]>();
	for (const { imdbId, hash } of pairs)
		byTitle.set(imdbId, [...(byTitle.get(imdbId) ?? []), hash]);
	const names = new Map<string, string>();
	await Promise.all(
		[...byTitle].map(async ([imdbId, hashes]) => {
			const found = await scraped!.getFilenames(imdbId, hashes).catch(() => new Map());
			for (const [hash, name] of found) names.set(`${imdbId}:${hash}`, name);
		})
	);
	return pairs.map((pair) => {
		const mine = filed.filter((r) => r.imdbId === pair.imdbId && r.hash === pair.hash);
		const people = mine.filter((r) => r.userId !== JEV_REPORTER);
		const last = Math.max(0, ...mine.map((r) => r.createdAt.getTime()));
		return {
			imdbId: pair.imdbId,
			hash: pair.hash,
			filename: names.get(`${pair.imdbId}:${pair.hash}`) ?? null,
			types: [...new Set(mine.map((r) => r.type))].sort(),
			reporters: new Set(people.map((r) => r.userId)).size,
			modelAgrees: mine.some((r) => r.userId === JEV_REPORTER),
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
			const { total, pairs } = await reports.listUndecidedReports(REPORTS_PAGE_SIZE, skip);
			return res.status(200).json({ total, items: await describe(pairs) });
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
