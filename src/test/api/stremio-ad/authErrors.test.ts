import report from '@/pages/api/report';
import library from '@/pages/api/stremio-ad/cast/library/[magnetIdPlusHash]';
import movie from '@/pages/api/stremio-ad/cast/movie/[imdbid]';
import profile from '@/pages/api/stremio-ad/cast/saveProfile';
import series from '@/pages/api/stremio-ad/cast/series/[imdbid]';
import limits from '@/pages/api/stremio-ad/cast/updateSizeLimits';
import remove from '@/pages/api/stremio-ad/deletelink';
import id from '@/pages/api/stremio-ad/id';
import links from '@/pages/api/stremio-ad/links';
import recordedFailures from '@/test/fixtures/castAddonFailures/play-failures-2026-10-04.json';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const provider = vi.hoisted(() => ({
	getAllDebridUser: vi.fn(),
	getMagnetStatusAd: vi.fn(),
	getMagnetFiles: vi.fn(),
	isAdStatusReady: vi.fn(),
}));
const db = vi.hoisted(() => ({
	deleteAllDebridCastedLink: vi.fn(),
	saveAllDebridCast: vi.fn(),
	reportContent: vi.fn(),
}));
vi.mock('@/services/allDebrid', () => provider);
vi.mock('@/services/repository', () => ({ repository: db }));
vi.mock('@/services/rateLimit/withRateLimit', () => ({
	RATE_LIMIT_CONFIGS: { report: {} },
	withIpRateLimit: (handler: unknown) => handler,
}));
vi.mock('@/services/scrapedVerdicts/reports', () => ({ reviewReportsInBackground: vi.fn() }));
vi.mock('@/utils/problemToken', () => ({ validateProblemToken: () => true }));
vi.mock('@/utils/castOtherStreamsLimit', () => ({ recordOtherStreamsGrant: vi.fn() }));
vi.mock('@/utils/requireSponsor', () => ({ sponsorIdOfRequest: vi.fn() }));
vi.mock('@/services/debridLink', () => ({ getDebridLinkAccountInfo: vi.fn() }));
vi.mock('@/services/offcloud', () => ({ getOffcloudAccountInfo: vi.fn() }));
vi.mock('@/services/premiumize', () => ({ getPremiumizeAccountInfo: vi.fn() }));
vi.mock('@/services/realDebrid', () => ({ getCurrentUser: vi.fn() }));
vi.mock('@/utils/torboxIdentity', () => ({ torboxUserId: vi.fn() }));

const salt = process.env.DMMCAST_SALT;
beforeEach(() => {
	vi.resetAllMocks();
	process.env.DMMCAST_SALT = 'test-salt';
	provider.getMagnetStatusAd.mockResolvedValue({ statusCode: 4 });
	provider.isAdStatusReady.mockReturnValue(true);
	provider.getMagnetFiles.mockResolvedValue({
		magnets: [
			{
				files: [
					{ n: 'example.mkv', s: 100, l: 'https://alldebrid.com/f/' + 'a'.repeat(43) },
				],
			},
		],
	});
});
afterAll(() => {
	if (salt === undefined) delete process.env.DMMCAST_SALT;
	else process.env.DMMCAST_SALT = salt;
});
const body = {
	apiKey: 'synthetic-key',
	imdbId: 'tt1234567',
	hash: 'a'.repeat(40),
	magnetId: 123456789,
	fileIndex: 0,
	streamUrl: 'https://alldebrid.com/f/' + 'a'.repeat(43),
	filename: 'example.mkv',
	fileSize: 100,
	files: [{}],
	userId: 'synthetic-key',
	type: 'malware',
	dmmProblemKey: 'proof',
	solution: 'proof',
};
const routes = [
	['id', id],
	['links', links],
	['saveProfile', profile],
	['updateSizeLimits', limits],
	['movie', movie],
	['series', series],
	['library', library],
	['deletelink', remove],
	['report', report],
] as const;
describe.each(routes)('%s AllDebrid authentication responses', (name, handler) => {
	it.each([
		['AUTH_BLOCKED', 403, /confirm.*email|email.*confirm/i],
		['AUTH_BAD_APIKEY', name === 'report' ? 403 : 401, /invalid|not verified/i],
		['AUTH_MISSING_APIKEY', name === 'report' ? 403 : 401, /invalid|not verified/i],
		[503, 503, /retry|try again/i],
		[429, 503, /retry|try again/i],
		[500, 500, /internal server error/i],
	] as const)(
		'returns actionable response for %s without modifying records',
		async (failure, status, message) => {
			const recorded =
				failure === 'AUTH_BLOCKED'
					? recordedFailures.responses['ad-unlock-auth-blocked']
					: failure === 'AUTH_BAD_APIKEY'
						? recordedFailures.responses['ad-unlock-bad-key']
						: null;
			const throttled = recordedFailures.responses['ad-throttled'];
			const error = recorded
				? Object.assign(new Error(recorded.body.error.message), recorded.body.error)
				: failure === 503
					? {
							response: { status: throttled.status, data: throttled.body },
							config: { headers: { Authorization: 'secret' } },
						}
					: typeof failure === 'string'
						? Object.assign(new Error('provider detail'), { code: failure })
						: {
								response: { status: failure, data: '' },
								config: { headers: { Authorization: 'secret' } },
							};
			// A refused key refuses every AllDebrid call, so the cast routes' magnet
			// verification (which now runs before /user) fails the same way.
			provider.getAllDebridUser.mockRejectedValue(error);
			provider.getMagnetStatusAd.mockRejectedValue(error);
			provider.getMagnetFiles.mockRejectedValue(error);
			const log = vi.spyOn(console, 'error').mockImplementation(() => {});
			const res = createMockResponse();
			await handler(
				createMockRequest({
					method: name === 'deletelink' ? 'DELETE' : 'POST',
					body,
					query: { imdbid: 'tt1234567', magnetIdPlusHash: '123456789:' + 'a'.repeat(40) },
				}),
				res
			);
			expect(res._getStatusCode()).toBe(status);
			const response = res._getData() as { errorMessage: string };
			expect(response.errorMessage).toMatch(message);
			expect(db.saveAllDebridCast).not.toHaveBeenCalled();
			expect(db.deleteAllDebridCastedLink).not.toHaveBeenCalled();
			expect(db.reportContent).not.toHaveBeenCalled();
			expect(JSON.stringify(log.mock.calls)).not.toContain('Authorization');
			log.mockRestore();
		}
	);
});
it('deletes using a single authenticated account lookup', async () => {
	provider.getAllDebridUser.mockResolvedValue({ username: 'synthetic-user', isPremium: true });
	db.deleteAllDebridCastedLink.mockResolvedValue(true);
	const log = vi.spyOn(console, 'error').mockImplementation(() => {});
	const res = createMockResponse();
	await remove(createMockRequest({ method: 'DELETE', body }), res);
	expect(res._getStatusCode()).toBe(200);
	expect(provider.getAllDebridUser).toHaveBeenCalledTimes(1);
	expect(db.deleteAllDebridCastedLink).toHaveBeenCalledWith(
		body.imdbId,
		expect.any(String),
		body.hash
	);
	log.mockRestore();
});
