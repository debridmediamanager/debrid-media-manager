import reportsHandler from '@/pages/api/admin/reports';
import { ReportService } from '@/services/database/report';
import { ScrapedVerdictService } from '@/services/database/scrapedVerdict';
import { JEV_DISPUTED, JEV_REPORTER } from '@/services/reporterId';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/rateLimit/withRateLimit', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/services/rateLimit/withRateLimit')>();
	return { ...actual, withIpRateLimit: (wrapped: unknown) => wrapped };
});

const TOKEN = 'test-admin-token';
const HASH = 'dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c';

const call = async (
	init: Parameters<typeof createMockRequest>[0],
	token: string | null = TOKEN
) => {
	const res = createMockResponse();
	await reportsHandler(
		createMockRequest({
			...init,
			headers: token ? { authorization: `Bearer ${token}` } : {},
		}) as any,
		res as any
	);
	return res;
};

const filed = (userId: string, type = 'wrong_imdb', at = '2026-11-10T10:00:00Z') => ({
	imdbId: 'tt1254207',
	hash: HASH,
	userId,
	type,
	createdAt: new Date(at),
});

beforeEach(() => {
	vi.stubEnv('ADMIN_TOKEN', TOKEN);
	vi.spyOn(ScrapedVerdictService.prototype, 'getListings').mockResolvedValue(
		new Map([[HASH, { title: 'Big.Buck.Bunny.2008.1080p.mkv', seasons: [] }]])
	);
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});

describe('/api/admin/reports', () => {
	it('refuses without the admin token', async () => {
		expect((await call({ method: 'GET' }, null))._getStatusCode()).toBe(401);
	});

	it('lists waiting reports with who reported them and what the model thinks', async () => {
		const list = vi.spyOn(ReportService.prototype, 'listUndecidedReports').mockResolvedValue({
			total: 1,
			pairs: [{ imdbId: 'tt1254207', hash: HASH }],
		});
		const counts = { all: 3, agrees: 1, disagrees: 1, unjudged: 1 };
		vi.spyOn(ReportService.prototype, 'countUndecidedByModel').mockResolvedValue(counts);
		vi.spyOn(ReportService.prototype, 'getReportsFor').mockResolvedValue([
			filed('rd:alice'),
			filed('rd:bob', 'porn', '2026-11-11T09:00:00Z'),
			filed(JEV_REPORTER),
		]);
		vi.spyOn(ReportService.prototype, 'getTitles').mockResolvedValue(
			new Map([
				['tt1254207', { title: 'Big Buck Bunny', year: 2008, kind: 'movie' as const }],
			])
		);
		const res = await call({ method: 'GET', query: { status: 'pending', model: 'agrees' } });
		expect(list).toHaveBeenCalledWith(25, 0, 'agrees');
		expect(res._getData()).toEqual({
			total: 1,
			counts,
			items: [
				{
					imdbId: 'tt1254207',
					hash: HASH,
					title: 'Big Buck Bunny',
					year: 2008,
					kind: 'movie',
					filename: 'Big.Buck.Bunny.2008.1080p.mkv',
					seasons: [],
					types: ['porn', 'wrong_imdb'],
					reporters: 2,
					model: 'agrees',
					lastReportedAt: '2026-11-11T09:00:00.000Z',
					decision: null,
					note: null,
					decidedAt: null,
				},
			],
		});
	});

	it('counts neither model entry as a reporter, and shows a dispute', async () => {
		vi.spyOn(ReportService.prototype, 'listUndecidedReports').mockResolvedValue({
			total: 1,
			pairs: [{ imdbId: 'tt1254207', hash: HASH }],
		});
		vi.spyOn(ReportService.prototype, 'countUndecidedByModel').mockResolvedValue({
			all: 1,
			agrees: 0,
			disagrees: 1,
			unjudged: 0,
		});
		vi.spyOn(ReportService.prototype, 'getReportsFor').mockResolvedValue([
			filed('rd:alice'),
			filed(JEV_DISPUTED),
		]);
		vi.spyOn(ReportService.prototype, 'getTitles').mockResolvedValue(new Map());
		const res = await call({ method: 'GET', query: { model: 'nonsense' } });
		const item = (res._getData() as { items: any[] }).items[0];
		expect(item).toMatchObject({ reporters: 1, model: 'disagrees' });
	});

	it('keeps every release the model disputed in one go', async () => {
		const keep = vi.spyOn(ReportService.prototype, 'keepModelDisputed').mockResolvedValue(42);
		const res = await call({ method: 'POST', body: { action: 'keepModelDisputed' } });
		expect(res._getStatusCode()).toBe(200);
		expect(res._getData()).toEqual({ kept: 42 });
		expect(keep).toHaveBeenCalledTimes(1);
	});

	it('hides a reported release on approval, with the note', async () => {
		vi.spyOn(ReportService.prototype, 'getReportsFor').mockResolvedValue([filed('rd:alice')]);
		const decide = vi.spyOn(ReportService.prototype, 'decide').mockResolvedValue();
		const res = await call({
			method: 'POST',
			body: { imdbId: 'tt1254207', hash: HASH, action: 'approve', note: ' fake ' },
		});
		expect(res._getStatusCode()).toBe(200);
		expect(decide).toHaveBeenCalledWith('tt1254207', HASH, 'approved', 'fake');
	});

	it('will not decide on a release nobody reported on that title', async () => {
		vi.spyOn(ReportService.prototype, 'getReportsFor').mockResolvedValue([]);
		const decide = vi.spyOn(ReportService.prototype, 'decide');
		const res = await call({
			method: 'POST',
			body: { imdbId: 'tt0000001', hash: HASH, action: 'approve' },
		});
		expect(res._getStatusCode()).toBe(404);
		expect(decide).not.toHaveBeenCalled();
	});

	it.each([
		[{ imdbId: '1254207', hash: HASH, action: 'approve' }, /imdbId/],
		[{ imdbId: 'tt1254207', hash: 'NOT A HASH', action: 'approve' }, /hash/],
		[{ imdbId: 'tt1254207', hash: HASH, action: 'delete' }, /action/],
	])('refuses %j', async (body, error) => {
		const res = await call({ method: 'POST', body });
		expect(res._getStatusCode()).toBe(400);
		expect((res._getData() as { error: string }).error).toMatch(error);
	});

	it('puts a decided release back in the queue', async () => {
		const undecide = vi.spyOn(ReportService.prototype, 'undecide').mockResolvedValue();
		const res = await call({
			method: 'POST',
			body: { imdbId: 'tt1254207', hash: HASH, action: 'reopen' },
		});
		expect(res._getStatusCode()).toBe(200);
		expect(undecide).toHaveBeenCalledWith('tt1254207', HASH);
	});

	it('says which season pages list a show release', async () => {
		vi.spyOn(ReportService.prototype, 'listUndecidedReports').mockResolvedValue({
			total: 1,
			pairs: [{ imdbId: 'tt15557874', hash: HASH }],
		});
		vi.spyOn(ReportService.prototype, 'countUndecidedByModel').mockResolvedValue({
			all: 1,
			agrees: 0,
			disagrees: 0,
			unjudged: 1,
		});
		vi.spyOn(ReportService.prototype, 'getReportsFor').mockResolvedValue([filed('rd:alice')]);
		vi.spyOn(ReportService.prototype, 'getTitles').mockResolvedValue(new Map());
		vi.spyOn(ScrapedVerdictService.prototype, 'getListings').mockResolvedValue(
			new Map([[HASH, { title: 'The Traitors S04E10', seasons: [4] }]])
		);
		const res = await call({ method: 'GET' });
		expect((res._getData() as { items: any[] }).items[0]).toMatchObject({
			filename: 'The Traitors S04E10',
			seasons: [4],
		});
	});

	describe('looking inside a release', () => {
		const pm = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body)));

		it('lists the files with links to play them, through the Premiumize setting', async () => {
			vi.stubEnv('INSPECT_PREMIUMIZE_KEY', 'pm-key');
			const fetchMock = pm({
				status: 'success',
				content: [
					{
						path: 'Show/poster.jpg',
						size: 10,
						link: 'https://cdn/poster.jpg',
						stream_link: null,
					},
					{
						path: 'Show/Show.S04E10.mkv',
						size: 2520000000,
						link: 'https://cdn/e10.mkv',
						stream_link: 'https://cdn/e10.mp4',
					},
				],
			});
			vi.stubGlobal('fetch', fetchMock);
			const res = await call({ method: 'POST', body: { action: 'inspect', hash: HASH } });
			expect(res._getStatusCode()).toBe(200);
			expect(res._getData()).toEqual({
				cached: true,
				files: [
					{
						path: 'Show/Show.S04E10.mkv',
						size: 2520000000,
						link: 'https://cdn/e10.mkv',
						streamLink: 'https://cdn/e10.mp4',
					},
					{
						path: 'Show/poster.jpg',
						size: 10,
						link: 'https://cdn/poster.jpg',
						streamLink: null,
					},
				],
			});
			const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
			expect(url).toBe('https://www.premiumize.me/api/transfer/directdl');
			expect((init.headers as Record<string, string>).Authorization).toBe('Bearer pm-key');
			expect(String(init.body)).toContain(`src=magnet%3A%3Fxt%3Durn%3Abtih%3A${HASH}`);
		});

		it('says so when Premiumize does not have it cached', async () => {
			vi.stubEnv('INSPECT_PREMIUMIZE_KEY', 'pm-key');
			vi.stubGlobal('fetch', pm({ status: 'error', message: 'content not in cache' }));
			const res = await call({ method: 'POST', body: { action: 'inspect', hash: HASH } });
			expect(res._getData()).toEqual({ cached: false, files: [] });
		});

		it('needs the Premiumize setting', async () => {
			vi.stubEnv('INSPECT_PREMIUMIZE_KEY', '');
			const fetchMock = vi.fn();
			vi.stubGlobal('fetch', fetchMock);
			const res = await call({ method: 'POST', body: { action: 'inspect', hash: HASH } });
			expect(res._getStatusCode()).toBe(503);
			expect(fetchMock).not.toHaveBeenCalled();
		});
	});
});
