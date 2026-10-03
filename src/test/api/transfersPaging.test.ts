import handler from '@/pages/api/transfers';
import { repository } from '@/services/repository';
import listings from '@/test/fixtures/transfers/jobs-mine-listings.json';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Card 110: the Transfers page showed the newest 100 rows and nothing older, so
// an account that had queued hundreds of single episodes could not see whether
// the earlier ones failed. The listings are two real accounts' `/jobs/mine`
// answers (see the fixture README); the services are modelled only as far as
// their own paging goes.

vi.mock('@/services/repository');
vi.mock('@/services/transferRegistration', () => ({
	__esModule: true,
	registerCompletedDebridJob: vi.fn().mockResolvedValue(false),
	registerCompletedNzb2rdJob: vi.fn().mockResolvedValue(false),
}));
vi.mock('@/services/debridUploaderServers', () => ({
	__esModule: true,
	getDebridUploaderServers: () => ['http://debrid02:3100'],
	resolveJobServer: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/services/nzb2rd', () => ({
	__esModule: true,
	getNzb2rdUrl: () => 'http://nzb2rd:3200',
}));
vi.mock('@/services/rateLimit/withRateLimit', () => ({
	__esModule: true,
	RATE_LIMIT_CONFIGS: { default: {} },
	withIpRateLimit: (h: unknown) => h,
}));

type Job = { id: string; status: string; created_at: string };
type Listing = { debrid: Job[]; nzb2rd: Job[] };

/**
 * A service's `/jobs/mine`, paged the way it pages.
 *
 * nzb2rd (`src/utils/paging.ts`) defaults to 60 rows and caps at 500; the debrid
 * uploader (`src/job-input.ts`) defaults to 100 and caps at 500. Both take any
 * offset. Neither returns a total.
 */
function jobsMine(rows: Job[], url: URL, fallback: number): Job[] {
	const raw = Number.parseInt(url.searchParams.get('limit') ?? '', 10);
	const limit = Number.isFinite(raw) && raw >= 0 ? Math.min(raw, 500) : fallback;
	const at = Number.parseInt(url.searchParams.get('offset') ?? '', 10);
	const offset = Number.isFinite(at) && at >= 0 ? at : 0;
	return rows.slice(offset, offset + limit);
}

const serviceCalls: URL[] = [];

function serve(listing: Listing) {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (href: string) => {
			const url = new URL(href);
			serviceCalls.push(url);
			const body =
				url.host === 'nzb2rd:3200'
					? jobsMine(listing.nzb2rd, url, 60)
					: jobsMine(listing.debrid, url, 100);
			return { ok: true, status: 200, json: async () => body };
		})
	);
}

const get = async (query: Record<string, string>) => {
	const req = createMockRequest({
		method: 'GET',
		headers: { 'x-rd-api-key': 'rd-key' },
		query,
	});
	const res = createMockResponse();
	await handler(req as any, res as any);
	return res;
};

/** Follow the page links from the newest page until there are none. */
async function walk(query: Record<string, string> = {}) {
	const pages: string[][] = [];
	let cursor: string | null | undefined;
	do {
		const res = await get(cursor ? { ...query, cursor } : query);
		expect(res._getStatusCode()).toBe(200);
		const body = res._getData() as {
			transfers: { source: string; id: string }[];
			next?: string;
		};
		pages.push(body.transfers.map((t) => `${t.source}:${t.id}`));
		cursor = body.next;
	} while (cursor && pages.length < 100);
	return pages;
}

/** Newest first across both services; a tie goes to the debrid host, listed first. */
function expectedOrder(listing: Listing): string[] {
	const at = (job: Job) => Date.parse(`${job.created_at.replace(' ', 'T')}Z`);
	return [
		...listing.debrid.map((job) => ({ key: `debrid:${job.id}`, at: at(job) })),
		...listing.nzb2rd.map((job) => ({ key: `nzb2rd:${job.id}`, at: at(job) })),
	]
		.sort((a, b) => b.at - a.at)
		.map((row) => row.key);
}

beforeEach(() => {
	vi.clearAllMocks();
	serviceCalls.length = 0;
	const repo = vi.mocked(repository);
	repo.getTransferMeta = vi.fn().mockResolvedValue(new Map());
	repo.recordNzb2rdTransferFailed = vi.fn().mockResolvedValue(undefined);
});

describe('GET /api/transfers — paging past the newest page', () => {
	it('reaches every one of a 648-transfer account, past the services’ 500-row cap', async () => {
		const listing = listings.heavyUsenet as Listing;
		serve(listing);

		const pages = await walk();
		const keys = pages.flat();

		expect(keys).toHaveLength(648);
		expect(keys).toEqual(expectedOrder(listing));
		expect(pages.map((p) => p.length)).toEqual([100, 100, 100, 100, 100, 100, 48]);
	});

	it('merges two services page by page into the order one list would have', async () => {
		// 41 TorBox/AllDebrid and 36 Usenet transfers, interleaved in time. Small
		// pages make every boundary fall somewhere different between the two.
		const listing = listings.mixed as Listing;
		serve(listing);

		for (const limit of ['1', '7', '10', '40', '76', '77', '100']) {
			const keys = (await walk({ limit })).flat();
			expect(keys).toEqual(expectedOrder(listing));
		}
	});

	it('asks each service for one page at a time, however deep the reader goes', async () => {
		// The old fan-out asked every service for offset+limit rows and sliced
		// afterwards, so each page cost more than the last and the 500-row cap
		// ended the list. A page now costs the same at any depth.
		serve(listings.heavyUsenet as Listing);

		await walk();

		expect(serviceCalls.length).toBeGreaterThan(0);
		for (const url of serviceCalls) {
			expect(Number(url.searchParams.get('limit'))).toBeLessThanOrEqual(101);
		}
		const deepest = Math.max(...serviceCalls.map((u) => Number(u.searchParams.get('offset'))));
		expect(deepest).toBe(600);
	});

	it('ends the links with the last page, rather than offering an empty one', async () => {
		serve({ debrid: [], nzb2rd: (listings.heavyUsenet as Listing).nzb2rd.slice(0, 200) });

		const pages = await walk();

		expect(pages.map((p) => p.length)).toEqual([100, 100]);
	});

	it('does not lose a transfer when a new one arrives between two pages', async () => {
		// Positions shift down by one when a transfer is started. The next page
		// then repeats the last row of the one before it; what it must never do is
		// skip one.
		const listing = { debrid: [], nzb2rd: [...(listings.heavyUsenet as Listing).nzb2rd] };
		serve(listing);

		const first = (await get({}))._getData() as { transfers: { id: string }[]; next: string };
		listing.nzb2rd.unshift({
			id: 'nzb2rd-new',
			status: 'pending',
			created_at: '2026-09-02 00:00:00',
		});
		const second = (await get({ cursor: first.next }))._getData() as {
			transfers: { id: string }[];
		};

		expect(second.transfers[0].id).toBe(first.transfers[99].id);
		const seen = new Set([...first.transfers, ...second.transfers].map((t) => t.id));
		for (const job of (listings.heavyUsenet as Listing).nzb2rd.slice(0, 199)) {
			expect(seen.has(job.id)).toBe(true);
		}
	});

	it('refuses a cursor it did not mint instead of quietly serving the first page', async () => {
		serve(listings.mixed as Listing);

		const res = await get({ cursor: 'not-a-cursor' });

		expect(res._getStatusCode()).toBe(400);
	});
});
