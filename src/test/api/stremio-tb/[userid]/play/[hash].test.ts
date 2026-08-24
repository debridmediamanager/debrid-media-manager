import handler from '@/pages/api/stremio-tb/[userid]/play/[hash]';
import { repository } from '@/services/repository';
import { requestDownloadLink, requestWebDownloadLink } from '@/services/torbox';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import {
	getBiggestFileTorBoxStreamUrl,
	getFileByNameTorBoxStreamUrl,
	getWebDownloadStreamUrlByHash,
} from '@/utils/getTorBoxStreamUrl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/services/torbox');
vi.mock('@/utils/getTorBoxStreamUrl');

const mockRepository = vi.mocked(repository);
const mockRequestDownloadLink = vi.mocked(requestDownloadLink);
const mockRequestWebDownloadLink = vi.mocked(requestWebDownloadLink);
const mockGetBiggestFile = vi.mocked(getBiggestFileTorBoxStreamUrl);
const mockGetFileByName = vi.mocked(getFileByNameTorBoxStreamUrl);
const mockGetWebDownloadByHash = vi.mocked(getWebDownloadStreamUrlByHash);

// TorBox hashes web downloads with md5, torrents with sha1
const WEB_DOWNLOAD_HASH = 'd41d8cd98f00b204e9800998ecf8427e';

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
		expect(mockGetBiggestFile).toHaveBeenCalledWith('key', 'abcdef1234', {
			releaseIfAdded: true,
		});
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
		expect(mockGetFileByName).toHaveBeenCalledWith('key', 'abcdef1234', 'episode.mkv', {
			releaseIfAdded: true,
		});
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
			'fbadffe5476df0674dbec75e81426895e40b6427',
			{ releaseIfAdded: true }
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
			'ep01.mkv',
			{ releaseIfAdded: true }
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

	describe('web downloads', () => {
		it('resolves webId:fileId through the webdl endpoint', async () => {
			mockRepository.getTorBoxCastProfile = vi.fn().mockResolvedValue({ apiKey: 'key' });
			mockRequestWebDownloadLink.mockResolvedValue({
				success: true,
				data: 'https://stream.test/webdl.mkv',
			} as any);
			const req = createMockRequest({
				query: { userid: 'user1', hash: '77:0', h: WEB_DOWNLOAD_HASH },
			});
			await handler(req, res);
			expect(mockRequestWebDownloadLink).toHaveBeenCalledWith(
				'key',
				{ web_id: 77, file_id: 0 },
				{ skipRetry: true, timeout: 8000 }
			);
			expect(mockRequestDownloadLink).not.toHaveBeenCalled();
			expect(res.redirect).toHaveBeenCalledWith('https://stream.test/webdl.mkv');
		});

		it('falls back to the web download hash lookup when the direct call fails', async () => {
			mockRepository.getTorBoxCastProfile = vi.fn().mockResolvedValue({ apiKey: 'key' });
			mockRequestWebDownloadLink.mockRejectedValue(new Error('stale id'));
			mockGetWebDownloadByHash.mockResolvedValue('https://stream.test/webdl-fallback.mkv');
			const req = createMockRequest({
				query: {
					userid: 'user1',
					hash: '77:0',
					h: WEB_DOWNLOAD_HASH,
					file: 'episode.mkv',
				},
			});
			await handler(req, res);
			expect(mockGetWebDownloadByHash).toHaveBeenCalledWith(
				'key',
				WEB_DOWNLOAD_HASH,
				'episode.mkv'
			);
			expect(mockGetFileByName).not.toHaveBeenCalled();
			expect(res.redirect).toHaveBeenCalledWith('https://stream.test/webdl-fallback.mkv');
		});

		it('resolves a bare web download hash', async () => {
			mockRepository.getTorBoxCastProfile = vi.fn().mockResolvedValue({ apiKey: 'key' });
			mockGetWebDownloadByHash.mockResolvedValue('https://stream.test/webdl-legacy.mkv');
			const req = createMockRequest({
				query: { userid: 'user1', hash: WEB_DOWNLOAD_HASH },
			});
			await handler(req, res);
			expect(mockGetWebDownloadByHash).toHaveBeenCalledWith(
				'key',
				WEB_DOWNLOAD_HASH,
				undefined
			);
			expect(mockGetBiggestFile).not.toHaveBeenCalled();
			expect(res.redirect).toHaveBeenCalledWith('https://stream.test/webdl-legacy.mkv');
		});

		it('returns 500 when the web download cannot be resolved', async () => {
			mockRepository.getTorBoxCastProfile = vi.fn().mockResolvedValue({ apiKey: 'key' });
			mockGetWebDownloadByHash.mockRejectedValue(new Error('Web download not found'));
			const req = createMockRequest({
				query: { userid: 'user1', hash: WEB_DOWNLOAD_HASH },
			});
			await handler(req, res);
			expect(res.status).toHaveBeenCalledWith(500);
		});
	});

	// Regression: a TorBox torrent id only resolves inside the account that
	// created it - three of three foreign ids answered 500 DATABASE_ERROR when
	// probed on 2026-08-24 - so for someone else's cast the direct lookup is a
	// guaranteed round trip into a wall before the hash fallback runs.
	it("goes straight to the hash for a cast that is not the viewer's own", async () => {
		mockRepository.getTorBoxCastProfile = vi.fn().mockResolvedValue({ apiKey: 'key' });
		vi.mocked(getFileByNameTorBoxStreamUrl).mockResolvedValue([
			'https://tb/dl',
			1,
			2,
			3,
			'Show.S01E01.mkv',
		] as any);

		const req = createMockRequest({
			query: {
				userid: 'user1',
				hash: '999:0',
				h: 'fbadffe5476df0674dbec75e81426895e40b6427',
				file: 'Show.S01E01.mkv',
			},
		});
		await handler(req, res);

		expect(requestDownloadLink).not.toHaveBeenCalled();
		expect(res.redirect).toHaveBeenCalledWith('https://tb/dl');
	});

	it("still tries the direct lookup for the caster's own row", async () => {
		mockRepository.getTorBoxCastProfile = vi.fn().mockResolvedValue({ apiKey: 'key' });
		vi.mocked(requestDownloadLink).mockResolvedValue({
			success: true,
			data: 'https://tb/direct',
		} as any);

		const req = createMockRequest({
			query: {
				userid: 'user1',
				hash: '999:0',
				h: 'fbadffe5476df0674dbec75e81426895e40b6427',
				file: 'Show.S01E01.mkv',
				own: '1',
			},
		});
		await handler(req, res);

		expect(requestDownloadLink).toHaveBeenCalled();
		expect(res.redirect).toHaveBeenCalledWith('https://tb/direct');
	});

	// The viewer never asked for the torrent that had to be added to resolve
	// someone else's cast, so the play path hands it straight back.
	it('asks the hash fallback to release whatever it added', async () => {
		mockRepository.getTorBoxCastProfile = vi.fn().mockResolvedValue({ apiKey: 'key' });
		vi.mocked(getFileByNameTorBoxStreamUrl).mockResolvedValue([
			'https://tb/dl',
			1,
			2,
			3,
			'Show.S01E01.mkv',
		] as any);

		const req = createMockRequest({
			query: {
				userid: 'user1',
				hash: '999:0',
				h: 'fbadffe5476df0674dbec75e81426895e40b6427',
				file: 'Show.S01E01.mkv',
			},
		});
		await handler(req, res);

		expect(getFileByNameTorBoxStreamUrl).toHaveBeenCalledWith(
			'key',
			'fbadffe5476df0674dbec75e81426895e40b6427',
			'Show.S01E01.mkv',
			{ releaseIfAdded: true }
		);
	});

	it('releases on the legacy hash-only form as well', async () => {
		mockRepository.getTorBoxCastProfile = vi.fn().mockResolvedValue({ apiKey: 'key' });
		vi.mocked(getBiggestFileTorBoxStreamUrl).mockResolvedValue([
			'https://tb/dl',
			1,
			2,
			3,
			'Movie.mkv',
		] as any);

		const req = createMockRequest({
			query: { userid: 'user1', hash: 'fbadffe5476df0674dbec75e81426895e40b6427' },
		});
		await handler(req, res);

		expect(getBiggestFileTorBoxStreamUrl).toHaveBeenCalledWith(
			'key',
			'fbadffe5476df0674dbec75e81426895e40b6427',
			{ releaseIfAdded: true }
		);
	});
});
