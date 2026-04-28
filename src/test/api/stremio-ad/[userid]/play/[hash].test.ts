import handler from '@/pages/api/stremio-ad/[userid]/play/[hash]';
import { getMagnetFiles, unlockLink } from '@/services/allDebrid';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/services/allDebrid');

const mockRepository = vi.mocked(repository);
const mockGetMagnetFiles = vi.mocked(getMagnetFiles);
const mockUnlockLink = vi.mocked(unlockLink);

describe('/api/stremio-ad/[userid]/play/[hash]', () => {
	let res: ReturnType<typeof createMockResponse>;

	beforeEach(() => {
		vi.clearAllMocks();
		res = createMockResponse();
		mockRepository.getAllDebridCastProfile = vi.fn();
	});

	it('sets CORS header', async () => {
		mockRepository.getAllDebridCastProfile = vi.fn().mockResolvedValue(null);
		const req = createMockRequest({ query: { userid: 'user1', hash: '123:0' } });
		await handler(req, res);
		expect(res.setHeader).toHaveBeenCalledWith('access-control-allow-origin', '*');
	});

	it('sets no-cache headers', async () => {
		mockRepository.getAllDebridCastProfile = vi.fn().mockResolvedValue(null);
		const req = createMockRequest({ query: { userid: 'user1', hash: '123:0' } });
		await handler(req, res);
		expect(res.setHeader).toHaveBeenCalledWith(
			'Cache-Control',
			'no-store, no-cache, must-revalidate'
		);
	});

	it('returns 400 when userid or hash is missing', async () => {
		const req = createMockRequest({ query: { userid: 'user1' } });
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(400);
	});

	it('returns 400 for invalid hash format', async () => {
		const req = createMockRequest({ query: { userid: 'user1', hash: 'invalid' } });
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(400);
		const data = res._getData() as any;
		expect(data.errorMessage).toContain('magnetId:fileIndex');
	});

	it('returns 400 when magnetId is NaN', async () => {
		const req = createMockRequest({ query: { userid: 'user1', hash: 'abc:0' } });
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(400);
	});

	it('returns 400 when fileIndex is NaN', async () => {
		const req = createMockRequest({ query: { userid: 'user1', hash: '123:abc' } });
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(400);
	});

	it('returns 500 when no profile found', async () => {
		mockRepository.getAllDebridCastProfile = vi.fn().mockResolvedValue(null);
		const req = createMockRequest({ query: { userid: 'user1', hash: '123:0' } });
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(500);
	});

	it('redirects on success', async () => {
		mockRepository.getAllDebridCastProfile = vi.fn().mockResolvedValue({ apiKey: 'key' });
		mockGetMagnetFiles.mockResolvedValue({
			magnets: [
				{
					files: [{ n: 'movie.mkv', s: 1000, l: 'https://link.test/file' }],
				},
			],
		} as any);
		mockUnlockLink.mockResolvedValue({ link: 'https://stream.test/video.mkv' } as any);
		const req = createMockRequest({ query: { userid: 'user1', hash: '123:0' } });
		await handler(req, res);
		expect(res.redirect).toHaveBeenCalledWith('https://stream.test/video.mkv');
	});

	it('returns 500 when magnet not found', async () => {
		mockRepository.getAllDebridCastProfile = vi.fn().mockResolvedValue({ apiKey: 'key' });
		mockGetMagnetFiles.mockResolvedValue({ magnets: [] } as any);
		const req = createMockRequest({ query: { userid: 'user1', hash: '123:0' } });
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(500);
	});

	it('returns 500 when file index out of range', async () => {
		mockRepository.getAllDebridCastProfile = vi.fn().mockResolvedValue({ apiKey: 'key' });
		mockGetMagnetFiles.mockResolvedValue({
			magnets: [
				{
					files: [{ n: 'movie.mkv', s: 1000, l: 'https://link.test/file' }],
				},
			],
		} as any);
		const req = createMockRequest({ query: { userid: 'user1', hash: '123:5' } });
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(500);
	});

	it('returns 500 on error', async () => {
		mockRepository.getAllDebridCastProfile = vi.fn().mockResolvedValue({ apiKey: 'key' });
		mockGetMagnetFiles.mockRejectedValue(new Error('API error'));
		const req = createMockRequest({ query: { userid: 'user1', hash: '123:0' } });
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(500);
	});
});
