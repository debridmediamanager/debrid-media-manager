import handler from '@/pages/api/stremio-pm/[userid]/play/item/[id]';
import { getPremiumizeItemDetails } from '@/services/premiumize';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/services/premiumize', async () => {
	const actual =
		await vi.importActual<typeof import('@/services/premiumize')>('@/services/premiumize');
	return { ...actual, getPremiumizeItemDetails: vi.fn() };
});

const mockRepository = vi.mocked(repository);
const mockDetails = vi.mocked(getPremiumizeItemDetails);

describe('/api/stremio-pm/[userid]/play/item/[id]', () => {
	let res: ReturnType<typeof createMockResponse>;

	beforeEach(() => {
		vi.clearAllMocks();
		res = createMockResponse();
		mockRepository.getPremiumizeCastProfile = vi.fn().mockResolvedValue({ apiKey: 'pm-key' });
	});

	it('prefers the transcoded stream_link and never caches the redirect', async () => {
		mockDetails.mockResolvedValue({
			link: 'https://cdn/orig',
			stream_link: 'https://cdn/stream',
		} as any);
		await handler(createMockRequest({ query: { userid: 'user1', id: 'v1' } }), res);
		expect(res.redirect).toHaveBeenCalledWith('https://cdn/stream');
		expect(res.setHeader).toHaveBeenCalledWith(
			'Cache-Control',
			'no-store, no-cache, must-revalidate'
		);
	});

	it('falls back to link when Premiumize did not transcode the file', async () => {
		mockDetails.mockResolvedValue({ link: 'https://cdn/orig', stream_link: null } as any);
		await handler(createMockRequest({ query: { userid: 'user1', id: 'v1' } }), res);
		expect(res.redirect).toHaveBeenCalledWith('https://cdn/orig');
	});

	it('returns 400 when userid or id is missing', async () => {
		await handler(createMockRequest({ query: { userid: 'user1' } }), res);
		expect(res.status).toHaveBeenCalledWith(400);
	});

	it('returns 500 when the user has no Premiumize profile', async () => {
		mockRepository.getPremiumizeCastProfile = vi.fn().mockResolvedValue(null);
		await handler(createMockRequest({ query: { userid: 'user1', id: 'v1' } }), res);
		expect(res.status).toHaveBeenCalledWith(500);
	});

	it('returns 500 when Premiumize hands back no link', async () => {
		mockDetails.mockResolvedValue({ link: null, stream_link: null } as any);
		await handler(createMockRequest({ query: { userid: 'user1', id: 'v1' } }), res);
		expect(res.status).toHaveBeenCalledWith(500);
	});
});
