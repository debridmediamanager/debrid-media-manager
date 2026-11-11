import reportsHandler from '@/pages/api/admin/reports';
import { ReportService } from '@/services/database/report';
import { ScrapedVerdictService } from '@/services/database/scrapedVerdict';
import { JEV_REPORTER } from '@/services/reporterId';
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
	vi.spyOn(ScrapedVerdictService.prototype, 'getFilenames').mockResolvedValue(
		new Map([[HASH, 'Big.Buck.Bunny.2008.1080p.mkv']])
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
		vi.spyOn(ReportService.prototype, 'listUndecidedReports').mockResolvedValue({
			total: 1,
			pairs: [{ imdbId: 'tt1254207', hash: HASH }],
		});
		vi.spyOn(ReportService.prototype, 'getReportsFor').mockResolvedValue([
			filed('rd:alice'),
			filed('rd:bob', 'porn', '2026-11-11T09:00:00Z'),
			filed(JEV_REPORTER),
		]);
		const res = await call({ method: 'GET', query: { status: 'pending' } });
		expect(res._getData()).toEqual({
			total: 1,
			items: [
				{
					imdbId: 'tt1254207',
					hash: HASH,
					filename: 'Big.Buck.Bunny.2008.1080p.mkv',
					types: ['porn', 'wrong_imdb'],
					reporters: 2,
					modelAgrees: true,
					lastReportedAt: '2026-11-11T09:00:00.000Z',
					decision: null,
					note: null,
					decidedAt: null,
				},
			],
		});
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
});
