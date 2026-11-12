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
		/** Answers each provider's URL with its scripted body; records every call. */
		const providers = (routes: Record<string, unknown>) => {
			const fetchMock = vi.fn(async (url: string | URL, _init?: RequestInit) => {
				const key = Object.keys(routes).find((k) => String(url).includes(k));
				if (!key) throw new Error(`unexpected ${url}`);
				const body = routes[key];
				return body === 204
					? new Response(null, { status: 204 })
					: new Response(JSON.stringify(body));
			});
			vi.stubGlobal('fetch', fetchMock);
			return fetchMock;
		};
		const inspect = () => call({ method: 'POST', body: { action: 'inspect', hash: HASH } });
		const keys = () => {
			vi.stubEnv('INSPECT_PREMIUMIZE_KEY', 'pm-key');
			vi.stubEnv('REALDEBRID_KEY', 'RDKEY');
			vi.stubEnv('INSPECT_TORBOX_KEY', 'tb-key');
		};

		it('plays what Premiumize has cached, first', async () => {
			keys();
			const fetchMock = providers({
				'premiumize.me/api/transfer/directdl': {
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
				},
			});
			const res = await inspect();
			expect(res._getStatusCode()).toBe(200);
			expect(res._getData()).toEqual({
				cached: true,
				provider: 'premiumize',
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
			expect(fetchMock).toHaveBeenCalledTimes(1);
			const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
			expect(url).toBe('https://www.premiumize.me/api/transfer/directdl');
			expect((init.headers as Record<string, string>).Authorization).toBe('Bearer pm-key');
			expect(String(init.body)).toContain(`src=magnet%3A%3Fxt%3Durn%3Abtih%3A${HASH}`);
		});

		// Real-Debrid records which IP downloads each link, and its account lives on one
		// IP: the server reads the file list and makes no links for a browser elsewhere.
		it('lists the files Real-Debrid knows without making any link, and removes the torrent', async () => {
			keys();
			const fetchMock = providers({
				'premiumize.me': { status: 'error', message: 'not cached' },
				'torrents/addMagnet': {
					id: 'ABC123',
					uri: 'https://api.real-debrid.com/rest/1.0/torrents/info/ABC123',
				},
				'torrents/info/ABC123': {
					status: 'waiting_files_selection',
					files: [
						{ id: 1, path: '/Show/sample.mkv', bytes: 5000000, selected: 0 },
						{ id: 2, path: '/Show/Show.S04E10.mkv', bytes: 2520000000, selected: 0 },
					],
				},
				'torrents/delete/ABC123': 204,
			});
			const res = await inspect();
			expect(res._getData()).toEqual({
				cached: true,
				provider: 'realdebrid',
				files: [
					{
						path: 'Show/Show.S04E10.mkv',
						size: 2520000000,
						link: null,
						streamLink: null,
					},
					{ path: 'Show/sample.mkv', size: 5000000, link: null, streamLink: null },
				],
			});
			const urls = fetchMock.mock.calls.map(([u]) => String(u));
			expect(urls.some((u) => u.includes('selectFiles') || u.includes('unrestrict'))).toBe(
				false
			);
			const del = fetchMock.mock.calls.find(([u]) =>
				String(u).includes('torrents/delete/ABC123')
			);
			expect((del![1] as RequestInit).method).toBe('DELETE');
			const add = fetchMock.mock.calls.find(([u]) => String(u).includes('addMagnet'));
			expect(((add![1] as RequestInit).headers as Record<string, string>).Authorization).toBe(
				'Bearer RDKEY'
			);
		});

		it('falls back to the TorBox file list, and still removes the Real-Debrid torrent', async () => {
			keys();
			const fetchMock = providers({
				'premiumize.me': { status: 'error', message: 'not cached' },
				'torrents/addMagnet': { id: 'DEF456' },
				'torrents/info/DEF456': { status: 'magnet_error', files: [] },
				'torrents/delete/DEF456': 204,
				'torbox.app/v1/api/torrents/checkcached': {
					success: true,
					data: [
						{
							name: 'Show',
							size: 300,
							files: [{ name: 'Show/Show.S04E10.mkv', size: 300 }],
						},
					],
				},
			});
			const res = await inspect();
			expect(res._getData()).toEqual({
				cached: true,
				provider: 'torbox',
				files: [{ path: 'Show/Show.S04E10.mkv', size: 300, link: null, streamLink: null }],
			});
			expect(
				fetchMock.mock.calls.some(([u]) => String(u).includes('torrents/delete/DEF456'))
			).toBe(true);
			const tb = fetchMock.mock.calls.find(([u]) => String(u).includes('checkcached'))!;
			expect(String(tb[0])).toContain(`hash=${HASH}`);
			expect(String(tb[0])).toContain('list_files=true');
		});

		it('says so when no provider has it', async () => {
			keys();
			providers({
				'premiumize.me': { status: 'error', message: 'not cached' },
				'torrents/addMagnet': { id: 'GHI789' },
				'torrents/info/GHI789': { status: 'magnet_error', files: [] },
				'torrents/delete/GHI789': 204,
				checkcached: { success: true, data: [] },
			});
			expect((await inspect())._getData()).toEqual({
				cached: false,
				provider: null,
				files: [],
			});
		});

		it('needs at least one provider key', async () => {
			vi.stubEnv('INSPECT_PREMIUMIZE_KEY', '');
			vi.stubEnv('REALDEBRID_KEY', '');
			vi.stubEnv('INSPECT_TORBOX_KEY', '');
			const fetchMock = vi.fn();
			vi.stubGlobal('fetch', fetchMock);
			const res = await inspect();
			expect(res._getStatusCode()).toBe(503);
			expect(fetchMock).not.toHaveBeenCalled();
		});
	});

	describe('removing a release from one season page', () => {
		const pair = {
			source: 'ScrapedTrue' as const,
			hash: HASH,
			title: 'Rockman.EXE Stream - 01-10',
			fileSize: 2.4e9,
		};
		const listedOn = (seasons: number[]) =>
			vi
				.spyOn(ScrapedVerdictService.prototype, 'getListings')
				.mockResolvedValue(new Map([[HASH, { title: pair.title, seasons }]]));
		beforeEach(() => {
			vi.spyOn(ReportService.prototype, 'getReportsFor').mockResolvedValue([
				filed('rd:alice', 'wrong_season'),
			]);
			vi.spyOn(ReportService.prototype, 'getTitles').mockResolvedValue(
				new Map([
					[
						'tt4909124',
						{ title: 'MegaMan NT Warrior', year: 2002, kind: 'show' as const },
					],
				])
			);
		});

		it('takes it off that season only and closes the report, since it stays on another', async () => {
			listedOn([1, 3]);
			const stored = vi
				.spyOn(ScrapedVerdictService.prototype, 'getStoredPairs')
				.mockResolvedValue({
					pairs: [pair, { ...pair, hash: 'other' }],
					lastChanged: null,
				});
			const trash = vi
				.spyOn(ScrapedVerdictService.prototype, 'trashPairs')
				.mockResolvedValue(1);
			const decide = vi.spyOn(ReportService.prototype, 'decide').mockResolvedValue();
			const res = await call({
				method: 'POST',
				body: { imdbId: 'tt4909124', hash: HASH, action: 'removeFromSeason', season: 1 },
			});
			expect(res._getStatusCode()).toBe(200);
			expect(stored).toHaveBeenCalledWith('tv:tt4909124:1');
			expect(trash).toHaveBeenCalledWith(
				'tv:tt4909124:1',
				{ imdbId: 'tt4909124', name: 'MegaMan NT Warrior' },
				[{ ...pair, rule: 'admin-season' }],
				'admin /admin/reports'
			);
			expect(decide).toHaveBeenCalledWith(
				'tt4909124',
				HASH,
				'dismissed',
				'Removed from season 1 only; it stays on season 3'
			);
		});

		it('hides it when that was the only season listing it', async () => {
			listedOn([1]);
			vi.spyOn(ScrapedVerdictService.prototype, 'getStoredPairs').mockResolvedValue({
				pairs: [pair],
				lastChanged: null,
			});
			vi.spyOn(ScrapedVerdictService.prototype, 'trashPairs').mockResolvedValue(1);
			const decide = vi.spyOn(ReportService.prototype, 'decide').mockResolvedValue();
			await call({
				method: 'POST',
				body: { imdbId: 'tt4909124', hash: HASH, action: 'removeFromSeason', season: 1 },
			});
			expect(decide).toHaveBeenCalledWith(
				'tt4909124',
				HASH,
				'approved',
				'Removed from season 1, its only season page'
			);
		});

		it('refuses a season the release is not listed on', async () => {
			listedOn([3]);
			const trash = vi.spyOn(ScrapedVerdictService.prototype, 'trashPairs');
			const res = await call({
				method: 'POST',
				body: { imdbId: 'tt4909124', hash: HASH, action: 'removeFromSeason', season: 1 },
			});
			expect(res._getStatusCode()).toBe(404);
			expect(trash).not.toHaveBeenCalled();
		});

		it('refuses a season that is not a number', async () => {
			const res = await call({
				method: 'POST',
				body: {
					imdbId: 'tt4909124',
					hash: HASH,
					action: 'removeFromSeason',
					season: 'one',
				},
			});
			expect(res._getStatusCode()).toBe(400);
		});
	});
});
