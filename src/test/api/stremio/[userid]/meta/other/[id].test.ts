import handler from '@/pages/api/stremio/[userid]/meta/other/[id]';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockIsLegacyToken, mockGetCastProfile, mockGetToken, mockGetDMMTorrent } = vi.hoisted(
	() => ({
		mockIsLegacyToken: vi.fn(),
		mockGetCastProfile: vi.fn(),
		mockGetToken: vi.fn(),
		mockGetDMMTorrent: vi.fn(),
	})
);

vi.mock('@/utils/castApiHelpers', () => ({
	isLegacyToken: mockIsLegacyToken,
}));

vi.mock('@/services/repository', () => ({
	repository: {
		getCastProfile: mockGetCastProfile,
	},
}));

vi.mock('@/services/realDebrid', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/services/realDebrid')>()),
	getToken: mockGetToken,
}));

vi.mock('@/utils/castCatalogHelper', () => ({
	getDMMTorrent: mockGetDMMTorrent,
}));

describe('/api/stremio/[userid]/meta/other/[id]', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockIsLegacyToken.mockReturnValue(false);
		mockGetCastProfile.mockResolvedValue({
			clientId: 'id',
			clientSecret: 'secret',
			refreshToken: 'refresh',
		});
		mockGetToken.mockResolvedValue({ access_token: 'rd-token' });
		mockGetDMMTorrent.mockResolvedValue({ status: 200, data: { meta: { id: 'dmm:1' } } });
	});

	it('validates query params', async () => {
		const req = createMockRequest({ query: { userid: ['u'] as any, id: 'dmm:1' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
	});

	it('sets CORS headers on all responses including errors', async () => {
		const testCases = [
			{
				name: 'invalid params',
				setup: () => {},
				query: { userid: ['u'] as any, id: 'dmm:1' },
			},
			{
				name: 'OPTIONS request',
				setup: () => {},
				query: { userid: 'user', id: 'dmm:1' },
				method: 'OPTIONS',
			},
			{
				name: 'legacy token',
				setup: () => mockIsLegacyToken.mockReturnValue(true),
				query: { userid: 'abcde', id: 'dmm:1' },
			},
			{
				name: 'missing profile',
				setup: () => mockGetCastProfile.mockResolvedValue(null),
				query: { userid: 'user', id: 'dmm:1' },
			},
			{
				name: 'token error',
				setup: () => mockGetToken.mockRejectedValue(new Error('oauth')),
				query: { userid: 'user', id: 'dmm:1' },
			},
			{
				name: 'success',
				setup: () => {},
				query: { userid: 'user', id: 'dmm:1' },
			},
		];

		for (const testCase of testCases) {
			vi.clearAllMocks();
			mockIsLegacyToken.mockReturnValue(false);
			mockGetCastProfile.mockResolvedValue({
				clientId: 'id',
				clientSecret: 'secret',
				refreshToken: 'refresh',
			});
			mockGetToken.mockResolvedValue({ access_token: 'rd-token' });
			mockGetDMMTorrent.mockResolvedValue({ status: 200, data: { meta: { id: 'dmm:1' } } });

			testCase.setup();

			const req = createMockRequest({
				query: testCase.query,
				method: testCase.method || 'GET',
			});
			const res = createMockResponse();

			await handler(req, res);

			expect(res.setHeader).toHaveBeenCalledWith('access-control-allow-origin', '*');
		}
	});

	it('supports OPTIONS preflight', async () => {
		const req = createMockRequest({
			method: 'OPTIONS',
			query: { userid: 'user', id: 'dmm:1' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
	});

	it('returns upgrade notice for legacy tokens', async () => {
		mockIsLegacyToken.mockReturnValue(true);
		const req = createMockRequest({ query: { userid: 'abcde', id: 'dmm:1' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith(
			expect.objectContaining({
				meta: expect.objectContaining({ id: 'dmm:1', type: 'other' }),
			})
		);
	});

	it('returns 500 when cast profile is missing', async () => {
		mockGetCastProfile.mockResolvedValue(null);
		const req = createMockRequest({ query: { userid: 'user', id: 'dmm:1' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(500);
		expect(res.json).toHaveBeenCalledWith({
			error: 'Failed to get Real-Debrid profile for user user',
		});
	});

	it('returns 500 when token acquisition fails', async () => {
		mockGetToken.mockRejectedValue(new Error('oauth'));
		const req = createMockRequest({ query: { userid: 'user', id: 'dmm:1' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(500);
		expect(res.json).toHaveBeenCalledWith({
			error: 'Failed to get Real-Debrid token for user user',
		});
	});

	it('proxies DMM torrent metadata on success', async () => {
		const req = createMockRequest({ query: { userid: 'user', id: 'dmm:1' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(mockGetDMMTorrent).toHaveBeenCalledWith('user', '1', 'rd-token');
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({ meta: { id: 'dmm:1' } });
	});

	it('surfaces downstream errors from getDMMTorrent', async () => {
		mockGetDMMTorrent.mockResolvedValue({ status: 404, error: 'missing' });
		const req = createMockRequest({ query: { userid: 'user', id: 'dmm:1' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(404);
		expect(res.json).toHaveBeenCalledWith({ error: 'missing' });
	});
});
