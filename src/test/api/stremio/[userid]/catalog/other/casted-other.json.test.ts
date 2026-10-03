import handler from '@/pages/api/stremio/[userid]/catalog/other/casted-other.json';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetDMMLibrary, mockIsLegacyToken } = vi.hoisted(() => ({
	mockGetDMMLibrary: vi.fn(),
	mockIsLegacyToken: vi.fn(),
}));

vi.mock('@/utils/castCatalogHelper', () => ({
	getDMMLibrary: mockGetDMMLibrary,
	PAGE_SIZE: 12,
}));

vi.mock('@/utils/castApiHelpers', () => ({
	isLegacyToken: mockIsLegacyToken,
}));

describe('/api/stremio/[userid]/catalog/other/casted-other.json', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockIsLegacyToken.mockReturnValue(false);
		mockGetDMMLibrary.mockResolvedValue({
			status: 200,
			data: { metas: [], hasMore: false, cacheMaxAge: 0 },
		});
	});

	it('validates userid input', async () => {
		const req = createMockRequest({ query: { userid: ['abc'] as any } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({
			status: 'error',
			errorMessage: 'Invalid "userid" query parameter',
		});
	});

	it('handles OPTIONS preflight requests', async () => {
		const req = createMockRequest({ method: 'OPTIONS', query: { userid: 'user' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(mockGetDMMLibrary).not.toHaveBeenCalled();
	});

	it('returns update instructions for legacy tokens', async () => {
		mockIsLegacyToken.mockReturnValue(true);
		const req = createMockRequest({ query: { userid: 'abcde' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({
			metas: [
				expect.objectContaining({
					id: 'dmm:update-required',
					type: 'other',
				}),
			],
		});
		expect(mockGetDMMLibrary).not.toHaveBeenCalled();
	});

	it('proxies DMM library results on success', async () => {
		mockGetDMMLibrary.mockResolvedValue({
			status: 200,
			data: { metas: [{ id: 'dmm:t1', type: 'other' }], cacheMaxAge: 0, hasMore: false },
		});
		const req = createMockRequest({ query: { userid: 'user123' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(mockGetDMMLibrary).toHaveBeenCalledWith('user123', 1);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({
			metas: [{ id: 'dmm:t1', type: 'other' }],
			cacheMaxAge: 0,
			hasMore: false,
		});
	});

	it('answers a failed library read with an uncached empty page', async () => {
		mockGetDMMLibrary.mockResolvedValue({ status: 500, error: 'bad' });
		const req = createMockRequest({ query: { userid: 'user123' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({ metas: [], hasMore: false, cacheMaxAge: 0 });
		expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
	});

	it('answers an expired Real-Debrid sign-in with a sign-in-again tile', async () => {
		mockGetDMMLibrary.mockResolvedValue({ status: 403, error: 'expired' });
		const req = createMockRequest({ query: { userid: 'user123' } });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect((res._getData() as any).metas).toEqual([
			expect.objectContaining({
				id: 'dmm:notice:credential',
				name: expect.stringContaining('Sign in to Real-Debrid again'),
			}),
		]);
	});
});
