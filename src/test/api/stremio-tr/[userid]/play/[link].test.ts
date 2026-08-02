import handler from '@/pages/api/stremio-tr/[userid]/play/[link]';
import { repository } from '@/services/repository';
import { unrestrictTorrinLink } from '@/services/torrin';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/services/torrin');

const mockRepository = vi.mocked(repository);
const mockUnrestrict = vi.mocked(unrestrictTorrinLink);

const profile = { baseUrl: 'https://tr.test', apiKey: 'key' };

describe('/api/stremio-tr/[userid]/play/[link]', () => {
	let res: ReturnType<typeof createMockResponse>;

	beforeEach(() => {
		vi.clearAllMocks();
		res = createMockResponse();
		mockRepository.getTorrinCastProfile = vi.fn();
	});

	it('sets CORS + no-cache headers', async () => {
		mockRepository.getTorrinCastProfile = vi.fn().mockResolvedValue(null);
		const req = createMockRequest({ query: { userid: 'user1', link: 'abc' } });
		await handler(req, res);
		expect(res.setHeader).toHaveBeenCalledWith('access-control-allow-origin', '*');
		expect(res.setHeader).toHaveBeenCalledWith(
			'Cache-Control',
			'no-store, no-cache, must-revalidate'
		);
	});

	it('returns 400 when userid or link is missing', async () => {
		const req = createMockRequest({ query: { userid: 'user1' } });
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(400);
	});

	it('returns 500 when no profile found', async () => {
		mockRepository.getTorrinCastProfile = vi.fn().mockResolvedValue(null);
		const req = createMockRequest({ query: { userid: 'user1', link: 'abc' } });
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(500);
	});

	it('unrestricts the decoded link and redirects on success', async () => {
		mockRepository.getTorrinCastProfile = vi.fn().mockResolvedValue(profile);
		mockUnrestrict.mockResolvedValue({ download: 'https://stream.test/v.mkv' } as any);
		const link = encodeURIComponent('https://tr.test/d/xyz');
		const req = createMockRequest({ query: { userid: 'user1', link } });
		await handler(req, res);
		expect(mockUnrestrict).toHaveBeenCalledWith(
			'https://tr.test',
			'key',
			'https://tr.test/d/xyz'
		);
		expect(res.redirect).toHaveBeenCalledWith('https://stream.test/v.mkv');
	});

	it('returns 500 when unrestrict returns no download', async () => {
		mockRepository.getTorrinCastProfile = vi.fn().mockResolvedValue(profile);
		mockUnrestrict.mockResolvedValue({ download: '' } as any);
		const req = createMockRequest({ query: { userid: 'user1', link: 'abc' } });
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(500);
	});

	it('returns 500 on unrestrict error', async () => {
		mockRepository.getTorrinCastProfile = vi.fn().mockResolvedValue(profile);
		mockUnrestrict.mockRejectedValue(new Error('boom'));
		const req = createMockRequest({ query: { userid: 'user1', link: 'abc' } });
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(500);
	});
});
