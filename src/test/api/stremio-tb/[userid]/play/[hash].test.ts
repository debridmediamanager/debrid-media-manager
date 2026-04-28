import handler from '@/pages/api/stremio-tb/[userid]/play/[hash]';
import { repository } from '@/services/repository';
import { requestDownloadLink } from '@/services/torbox';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import {
	getBiggestFileTorBoxStreamUrl,
	getFileByNameTorBoxStreamUrl,
} from '@/utils/getTorBoxStreamUrl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/services/torbox');
vi.mock('@/utils/getTorBoxStreamUrl');

const mockRepository = vi.mocked(repository);
const mockRequestDownloadLink = vi.mocked(requestDownloadLink);
const mockGetBiggestFile = vi.mocked(getBiggestFileTorBoxStreamUrl);
const mockGetFileByName = vi.mocked(getFileByNameTorBoxStreamUrl);

describe('/api/stremio-tb/[userid]/play/[hash]', () => {
	let res: ReturnType<typeof createMockResponse>;

	beforeEach(() => {
		vi.clearAllMocks();
		res = createMockResponse();
		mockRepository.getTorBoxCastProfile = vi.fn();
	});

	it('sets CORS header', async () => {
		mockRepository.getTorBoxCastProfile = vi.fn().mockResolvedValue(null);
		const req = createMockRequest({ query: { userid: 'user1', hash: '123:456' } });
		await handler(req, res);
		expect(res.setHeader).toHaveBeenCalledWith('access-control-allow-origin', '*');
	});

	it('sets no-cache headers', async () => {
		mockRepository.getTorBoxCastProfile = vi.fn().mockResolvedValue(null);
		const req = createMockRequest({ query: { userid: 'user1', hash: '123:456' } });
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

	it('returns 500 when no profile found', async () => {
		mockRepository.getTorBoxCastProfile = vi.fn().mockResolvedValue(null);
		const req = createMockRequest({ query: { userid: 'user1', hash: '123:456' } });
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(500);
	});

	it('redirects on success with torrentId:fileId format', async () => {
		mockRepository.getTorBoxCastProfile = vi.fn().mockResolvedValue({ apiKey: 'key' });
		mockRequestDownloadLink.mockResolvedValue({
			success: true,
			data: 'https://stream.test/video.mkv',
		} as any);
		const req = createMockRequest({ query: { userid: 'user1', hash: '123:456' } });
		await handler(req, res);
		expect(res.redirect).toHaveBeenCalledWith('https://stream.test/video.mkv');
	});

	it('returns 400 for invalid torrentId:fileId format with extra parts', async () => {
		mockRepository.getTorBoxCastProfile = vi.fn().mockResolvedValue({ apiKey: 'key' });
		const req = createMockRequest({ query: { userid: 'user1', hash: '1:2:3' } });
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(400);
	});

	it('returns 400 when torrentId is NaN', async () => {
		mockRepository.getTorBoxCastProfile = vi.fn().mockResolvedValue({ apiKey: 'key' });
		const req = createMockRequest({ query: { userid: 'user1', hash: 'abc:456' } });
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(400);
	});

	it('returns 400 when fileId is NaN', async () => {
		mockRepository.getTorBoxCastProfile = vi.fn().mockResolvedValue({ apiKey: 'key' });
		const req = createMockRequest({ query: { userid: 'user1', hash: '123:abc' } });
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(400);
	});

	it('falls back to hash lookup when direct download fails', async () => {
		mockRepository.getTorBoxCastProfile = vi.fn().mockResolvedValue({ apiKey: 'key' });
		mockRequestDownloadLink.mockRejectedValue(new Error('Failed'));
		mockGetBiggestFile.mockResolvedValue(['https://stream.test/fallback.mkv'] as any);
		const req = createMockRequest({
			query: { userid: 'user1', hash: '123:456', h: 'abcdef1234' },
		});
		await handler(req, res);
		expect(mockGetBiggestFile).toHaveBeenCalledWith('key', 'abcdef1234');
		expect(res.redirect).toHaveBeenCalledWith('https://stream.test/fallback.mkv');
	});

	it('falls back to hash with filename when direct download fails', async () => {
		mockRepository.getTorBoxCastProfile = vi.fn().mockResolvedValue({ apiKey: 'key' });
		mockRequestDownloadLink.mockRejectedValue(new Error('Failed'));
		mockGetFileByName.mockResolvedValue(['https://stream.test/episode.mkv'] as any);
		const req = createMockRequest({
			query: {
				userid: 'user1',
				hash: '123:456',
				h: 'abcdef1234',
				file: 'episode.mkv',
			},
		});
		await handler(req, res);
		expect(mockGetFileByName).toHaveBeenCalledWith('key', 'abcdef1234', 'episode.mkv');
		expect(res.redirect).toHaveBeenCalledWith('https://stream.test/episode.mkv');
	});

	it('uses legacy hash format with biggest file', async () => {
		mockRepository.getTorBoxCastProfile = vi.fn().mockResolvedValue({ apiKey: 'key' });
		mockGetBiggestFile.mockResolvedValue(['https://stream.test/movie.mkv'] as any);
		const req = createMockRequest({
			query: { userid: 'user1', hash: 'fbadffe5476df0674dbec75e81426895e40b6427' },
		});
		await handler(req, res);
		expect(mockGetBiggestFile).toHaveBeenCalledWith(
			'key',
			'fbadffe5476df0674dbec75e81426895e40b6427'
		);
		expect(res.redirect).toHaveBeenCalledWith('https://stream.test/movie.mkv');
	});

	it('uses legacy hash format with filename for episodes', async () => {
		mockRepository.getTorBoxCastProfile = vi.fn().mockResolvedValue({ apiKey: 'key' });
		mockGetFileByName.mockResolvedValue(['https://stream.test/ep01.mkv'] as any);
		const req = createMockRequest({
			query: {
				userid: 'user1',
				hash: 'fbadffe5476df0674dbec75e81426895e40b6427',
				file: 'ep01.mkv',
			},
		});
		await handler(req, res);
		expect(mockGetFileByName).toHaveBeenCalledWith(
			'key',
			'fbadffe5476df0674dbec75e81426895e40b6427',
			'ep01.mkv'
		);
		expect(res.redirect).toHaveBeenCalledWith('https://stream.test/ep01.mkv');
	});

	it('returns 500 when legacy hash stream URL is not found', async () => {
		mockRepository.getTorBoxCastProfile = vi.fn().mockResolvedValue({ apiKey: 'key' });
		mockGetBiggestFile.mockResolvedValue([undefined] as any);
		const req = createMockRequest({
			query: { userid: 'user1', hash: 'fbadffe5476df0674dbec75e81426895e40b6427' },
		});
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(500);
	});

	it('returns 500 on error', async () => {
		mockRepository.getTorBoxCastProfile = vi.fn().mockResolvedValue({ apiKey: 'key' });
		mockGetBiggestFile.mockRejectedValue(new Error('API error'));
		const req = createMockRequest({
			query: { userid: 'user1', hash: 'fbadffe5476df0674dbec75e81426895e40b6427' },
		});
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(500);
	});
});
