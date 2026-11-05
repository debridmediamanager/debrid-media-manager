import rarBundle from '@/test/fixtures/realdebrid/rd-rar-bundle-torrent-info.json';
import { AxiosError, AxiosHeaders } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import concurrentErrorInfo from './__fixtures__/rd-info-uncached-concurrent-error.json';
import downloadingInfo from './__fixtures__/rd-info-uncached-downloading.json';

const rdMocks = vi.hoisted(() => ({
	addHashAsMagnet: vi.fn(),
	deleteTorrent: vi.fn(),
	getTorrentInfo: vi.fn(),
	selectFiles: vi.fn(),
	unrestrictLink: vi.fn(),
}));

const clientIpMocks = vi.hoisted(() => ({
	getClientIpFromRequest: vi.fn(),
}));

const selectableMocks = vi.hoisted(() => ({
	isVideo: vi.fn(),
}));

vi.mock('@/services/realDebrid', () => rdMocks);
vi.mock('@/utils/clientIp', () => clientIpMocks);
vi.mock('@/utils/selectable', () => selectableMocks);
const prismaMocks = vi.hoisted(() => ({
	availableMusic: {
		findUnique: vi.fn(async () => null),
		deleteMany: vi.fn(async () => ({ count: 1 })),
	},
	availableMusicFile: {
		updateMany: vi.fn(async () => ({ count: 1 })),
		deleteMany: vi.fn(async () => ({ count: 1 })),
		count: vi.fn(async () => 17),
	},
}));
vi.mock('@/utils/prisma', () => ({ prisma: prismaMocks }));

/** An RD error as axios throws it. */
const rdError = (status: number, error: string, error_code: number) =>
	new AxiosError(error, String(status), undefined, undefined, {
		status,
		statusText: '',
		headers: {},
		config: { headers: new AxiosHeaders() },
		data: { error, error_code },
	});

import handler from '@/pages/api/music/unrestrict';
import { createMockRequest, createMockResponse } from '@/test/utils/api';

beforeEach(() => {
	vi.clearAllMocks();
	clientIpMocks.getClientIpFromRequest.mockReturnValue('127.0.0.1');
	selectableMocks.isVideo.mockReturnValue(true);
});

describe('API /api/music/unrestrict', () => {
	it.each([
		['RAR bundle', rarBundle.body, 6],
		[
			'missing file',
			{
				...rarBundle.body,
				files: [rarBundle.body.files[5]],
				links: ['https://real-debrid.com/d/SINGLE1234567890'],
			},
			999,
		],
	] as const)('does not unrestrict or return another file for a %s', async (_, info, fileId) => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.spyOn(console, 'log').mockImplementation(() => {});
		rdMocks.addHashAsMagnet.mockResolvedValue(rarBundle.body.id);
		rdMocks.getTorrentInfo.mockResolvedValue(info);
		rdMocks.selectFiles.mockResolvedValue(undefined);
		rdMocks.deleteTorrent.mockResolvedValue(undefined);
		rdMocks.unrestrictLink.mockResolvedValue({
			download: 'https://cdn.example.com/wrong-file.rar',
			filename: 'Sintel.rar',
			filesize: rarBundle.body.bytes,
		});
		const req = createMockRequest({
			method: 'POST',
			body: { accessToken: 'synthetic-token', hash: rarBundle.body.hash, fileId },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(502);
		expect(res._getData()).not.toHaveProperty('streamUrl');
		expect(rdMocks.unrestrictLink).not.toHaveBeenCalled();
		expect(rdMocks.deleteTorrent).toHaveBeenCalledWith(
			'synthetic-token',
			rarBundle.body.id,
			false
		);
		expect(prismaMocks.availableMusic.deleteMany).not.toHaveBeenCalled();
		expect(prismaMocks.availableMusicFile.deleteMany).not.toHaveBeenCalled();
		expect(prismaMocks.availableMusicFile.updateMany).not.toHaveBeenCalled();
	});

	it('rejects non-POST requests', async () => {
		const req = createMockRequest({ method: 'GET' });
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(405);
		expect(res._getData()).toEqual({ error: 'Method not allowed' });
	});

	it('returns 401 for missing accessToken', async () => {
		const req = createMockRequest({
			method: 'POST',
			body: { hash: 'abc123', fileId: 1 },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(401);
		expect(res._getData()).toEqual({ error: 'Missing access token' });
	});

	it('returns 400 for missing hash', async () => {
		const req = createMockRequest({
			method: 'POST',
			body: { accessToken: 'token123', fileId: 1 },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res._getData()).toEqual({ error: 'Missing hash or fileId' });
	});

	it('returns 400 for missing fileId', async () => {
		const req = createMockRequest({
			method: 'POST',
			body: { accessToken: 'token123', hash: 'abc123' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res._getData()).toEqual({ error: 'Missing hash or fileId' });
	});

	it('allows fileId of 0', async () => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		rdMocks.unrestrictLink.mockResolvedValue({
			download: 'https://example.com/track.flac',
			filename: 'track.flac',
			filesize: 50000000,
		});

		const req = createMockRequest({
			method: 'POST',
			body: { accessToken: 'token123', hash: 'abc123', fileId: 0, link: 'https://rd.link' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
	});

	it('returns stream URL via fast path when link is provided', async () => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		rdMocks.unrestrictLink.mockResolvedValue({
			download: 'https://example.com/song.mp3',
			filename: 'song.mp3',
			filesize: 5000000,
		});

		const req = createMockRequest({
			method: 'POST',
			body: {
				accessToken: 'token123',
				hash: 'abc123',
				fileId: 1,
				link: 'https://real-debrid.com/d/link123',
			},
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res._getData()).toEqual({
			streamUrl: 'https://example.com/song.mp3',
			filename: 'song.mp3',
			filesize: 5000000,
			mimeType: 'audio/mpeg',
		});
		expect(rdMocks.unrestrictLink).toHaveBeenCalledWith(
			'token123',
			'https://real-debrid.com/d/link123',
			'127.0.0.1',
			false
		);
		expect(rdMocks.addHashAsMagnet).not.toHaveBeenCalled();
	});

	it('falls back to magnet flow when fast path fails', async () => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		rdMocks.unrestrictLink
			.mockRejectedValueOnce(new Error('Link expired'))
			.mockResolvedValueOnce({
				download: 'https://example.com/track.flac',
				filename: 'track.flac',
				filesize: 40000000,
			});
		rdMocks.addHashAsMagnet.mockResolvedValue('torrent-id-1');
		rdMocks.getTorrentInfo
			.mockResolvedValueOnce({
				files: [
					{ id: 1, selected: false },
					{ id: 2, selected: false },
				],
				status: 'waiting_files_selection',
				links: [],
			})
			.mockResolvedValueOnce({
				files: [
					{ id: 1, selected: true },
					{ id: 2, selected: true },
				],
				status: 'downloaded',
				links: ['https://rd.link/1', 'https://rd.link/2'],
			});
		rdMocks.selectFiles.mockResolvedValue(undefined);
		rdMocks.deleteTorrent.mockResolvedValue(undefined);

		const req = createMockRequest({
			method: 'POST',
			body: {
				accessToken: 'token123',
				hash: 'abc123',
				fileId: 1,
				link: 'https://expired-link.com',
			},
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res._getData()).toEqual({
			streamUrl: 'https://example.com/track.flac',
			filename: 'track.flac',
			filesize: 40000000,
			mimeType: 'audio/flac',
		});
		expect(rdMocks.addHashAsMagnet).toHaveBeenCalledWith('token123', 'abc123', false, {
			names: [],
		});
		expect(rdMocks.deleteTorrent).toHaveBeenCalledWith('token123', 'torrent-id-1', false);
	});

	it('uses magnet flow when no link is provided', async () => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		rdMocks.addHashAsMagnet.mockResolvedValue('torrent-id-2');
		rdMocks.getTorrentInfo
			.mockResolvedValueOnce({
				files: [{ id: 5, selected: false }],
				status: 'waiting_files_selection',
				links: [],
			})
			.mockResolvedValueOnce({
				files: [{ id: 5, selected: true }],
				status: 'downloaded',
				links: ['https://rd.link/5'],
			});
		rdMocks.selectFiles.mockResolvedValue(undefined);
		rdMocks.unrestrictLink.mockResolvedValue({
			download: 'https://example.com/album/track01.ogg',
			filename: 'track01.ogg',
			filesize: 8000000,
		});
		rdMocks.deleteTorrent.mockResolvedValue(undefined);

		const req = createMockRequest({
			method: 'POST',
			body: { accessToken: 'token123', hash: 'def456', fileId: 5 },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(res._getData()).toEqual({
			streamUrl: 'https://example.com/album/track01.ogg',
			filename: 'track01.ogg',
			filesize: 8000000,
			mimeType: 'audio/ogg',
		});
	});

	describe('an album RD no longer has cached', () => {
		const hash = downloadingInfo.hash;
		beforeEach(() => {
			vi.spyOn(console, 'error').mockImplementation(() => {});
			vi.spyOn(console, 'log').mockImplementation(() => {});
			rdMocks.addHashAsMagnet.mockResolvedValue('torrent-id-err');
			rdMocks.selectFiles.mockResolvedValue(undefined);
			rdMocks.deleteTorrent.mockResolvedValue(undefined);
		});
		afterEach(() => vi.useRealTimers());

		const expectDropped = (res: ReturnType<typeof createMockResponse>) => {
			expect(res.status).toHaveBeenCalledWith(410);
			expect(res._getData()).toMatchObject({
				error: expect.stringContaining('no longer has this album cached'),
				dead: true,
			});
			expect(prismaMocks.availableMusic.deleteMany).toHaveBeenCalledWith({ where: { hash } });
			expect(rdMocks.deleteTorrent).toHaveBeenCalledWith('token123', 'torrent-id-err', false);
		};

		// Real RD answer: the same uncached album added twice at once, as play + prefetch do.
		it('drops it when RD turns the torrent to error', async () => {
			rdMocks.getTorrentInfo.mockResolvedValue(concurrentErrorInfo);
			const req = createMockRequest({
				method: 'POST',
				body: { accessToken: 'token123', hash, fileId: 1 },
			});
			const res = createMockResponse();

			await handler(req, res);

			expectDropped(res);
		});

		// Real RD answer: the same album added once, still downloading from peers.
		it('drops it when it is still downloading after the wait', async () => {
			vi.useFakeTimers();
			rdMocks.getTorrentInfo.mockResolvedValue(downloadingInfo);
			const req = createMockRequest({
				method: 'POST',
				body: { accessToken: 'token123', hash, fileId: 1 },
			});
			const res = createMockResponse();

			const done = handler(req, res);
			await vi.runAllTimersAsync();
			await done;

			expectDropped(res);
		});
	});

	describe('a track RD calls gone while the album plays', () => {
		const playTrack = async () => {
			vi.spyOn(console, 'error').mockImplementation(() => {});
			vi.spyOn(console, 'log').mockImplementation(() => {});
			rdMocks.addHashAsMagnet.mockResolvedValue('torrent-track');
			rdMocks.getTorrentInfo
				.mockResolvedValueOnce({
					files: [
						{ id: 1, path: '/01.flac', selected: false },
						{ id: 2, path: '/02.flac', selected: false },
					],
					status: 'waiting_files_selection',
					links: [],
				})
				.mockResolvedValueOnce({
					files: [
						{ id: 1, path: '/01.flac', selected: true },
						{ id: 2, path: '/02.flac', selected: true },
					],
					status: 'downloaded',
					links: ['https://rd.link/1', 'https://rd.link/2'],
				});
			rdMocks.selectFiles.mockResolvedValue(undefined);
			rdMocks.deleteTorrent.mockResolvedValue(undefined);
			rdMocks.unrestrictLink.mockRejectedValue(rdError(503, 'unavailable_file', 19));
			const req = createMockRequest({
				method: 'POST',
				body: { accessToken: 'token123', hash: 'abc', fileId: 2 },
			});
			const res = createMockResponse();
			await handler(req, res);
			return res;
		};

		it('drops only that track and keeps the album', async () => {
			const res = await playTrack();

			expect(res.status).toHaveBeenCalledWith(410);
			expect(res._getData()).toMatchObject({
				error: expect.stringContaining('The rest of the album still plays'),
				dead: true,
			});
			expect(prismaMocks.availableMusicFile.deleteMany).toHaveBeenCalledWith({
				where: { hash: 'abc', file_id: 2 },
			});
			expect(prismaMocks.availableMusic.deleteMany).not.toHaveBeenCalled();
		});

		it('drops the album with its last track', async () => {
			prismaMocks.availableMusicFile.count.mockResolvedValueOnce(0);

			await playTrack();

			expect(prismaMocks.availableMusic.deleteMany).toHaveBeenCalledWith({
				where: { hash: 'abc' },
			});
		});
	});

	// RD caches by the exact files selected, so ask for the spider's: every .flac and .mp3.
	it("selects the music spider's files, not the cover", async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.spyOn(console, 'log').mockImplementation(() => {});
		rdMocks.addHashAsMagnet.mockResolvedValue('torrent-sel');
		rdMocks.getTorrentInfo
			.mockResolvedValueOnce({ ...downloadingInfo, status: 'waiting_files_selection' })
			.mockResolvedValue(concurrentErrorInfo);
		rdMocks.selectFiles.mockResolvedValue(undefined);
		rdMocks.deleteTorrent.mockResolvedValue(undefined);
		const req = createMockRequest({
			method: 'POST',
			body: { accessToken: 'token123', hash: downloadingInfo.hash, fileId: 1 },
		});

		await handler(req, createMockResponse());

		const flac = downloadingInfo.files
			.filter((f) => f.path.endsWith('.flac'))
			.map((f) => `${f.id}`);
		expect(flac).toHaveLength(22);
		expect(rdMocks.selectFiles).toHaveBeenCalledWith('token123', 'torrent-sel', flac, false);
	});

	it.each([
		[rdError(403, 'permission_denied', 9), 403, 'premium'],
		[rdError(401, 'bad_token', 8), 401, 'Log in again'],
		[rdError(429, 'too_many_requests', 34), 429, 'Wait a minute'],
		// Another play of the same album deleted the torrent this one was reading.
		[rdError(404, 'unknown_ressource', 7), 502, 'Try again in a while'],
	])('explains %s to the listener and keeps the album', async (error, status, says) => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		rdMocks.addHashAsMagnet.mockRejectedValue(error);
		const req = createMockRequest({
			method: 'POST',
			body: { accessToken: 'token123', hash: 'abc', fileId: 1 },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(status);
		expect((res._getData() as { error: string }).error).toContain(says);
		expect(prismaMocks.availableMusic.deleteMany).not.toHaveBeenCalled();
	});

	it('replaces failed stored links once the album plays again', async () => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		rdMocks.unrestrictLink
			.mockRejectedValueOnce(rdError(503, 'hoster_unavailable', 19))
			.mockResolvedValueOnce({
				download: 'https://dl/2.flac',
				filename: '2.flac',
				filesize: 1,
			});
		rdMocks.addHashAsMagnet.mockResolvedValue('torrent-refresh');
		rdMocks.getTorrentInfo
			.mockResolvedValueOnce({
				files: [
					{ id: 1, selected: false },
					{ id: 2, selected: false },
				],
				status: 'waiting_files_selection',
				links: [],
			})
			.mockResolvedValueOnce({
				files: [
					{ id: 1, selected: true },
					{ id: 2, selected: true },
				],
				status: 'downloaded',
				links: ['https://real-debrid.com/d/NEW1', 'https://real-debrid.com/d/NEW2'],
			});
		rdMocks.selectFiles.mockResolvedValue(undefined);
		rdMocks.deleteTorrent.mockResolvedValue(undefined);
		const req = createMockRequest({
			method: 'POST',
			body: {
				accessToken: 'token123',
				hash: 'abc',
				fileId: 2,
				link: 'https://real-debrid.com/d/OLD2',
			},
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(prismaMocks.availableMusicFile.updateMany).toHaveBeenCalledWith({
			where: { hash: 'abc', file_id: 1 },
			data: { link: 'https://real-debrid.com/d/NEW1' },
		});
		expect(prismaMocks.availableMusicFile.updateMany).toHaveBeenCalledWith({
			where: { hash: 'abc', file_id: 2 },
			data: { link: 'https://real-debrid.com/d/NEW2' },
		});
	});

	it('handles cleanup failure silently', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.spyOn(console, 'log').mockImplementation(() => {});
		rdMocks.addHashAsMagnet.mockResolvedValue('torrent-id-cleanup');
		rdMocks.getTorrentInfo.mockRejectedValue(new Error('Network error'));
		rdMocks.deleteTorrent.mockRejectedValue(new Error('Cleanup also failed'));

		const req = createMockRequest({
			method: 'POST',
			body: { accessToken: 'token123', hash: 'fail123', fileId: 1 },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(502);
		expect(res._getData()).toMatchObject({ error: expect.stringContaining('Try again') });
		expect(prismaMocks.availableMusic.deleteMany).not.toHaveBeenCalled();
	});

	it('returns correct MIME type for .flac', async () => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		rdMocks.unrestrictLink.mockResolvedValue({
			download: 'https://example.com/song.flac',
			filename: 'song.flac',
			filesize: 30000000,
		});

		const req = createMockRequest({
			method: 'POST',
			body: {
				accessToken: 'token123',
				hash: 'abc',
				fileId: 1,
				link: 'https://link',
			},
		});
		const res = createMockResponse();

		await handler(req, res);

		expect((res._getData() as Record<string, unknown>).mimeType).toBe('audio/flac');
	});

	it('returns correct MIME type for .m4a', async () => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		rdMocks.unrestrictLink.mockResolvedValue({
			download: 'https://example.com/song.m4a',
			filename: 'song.m4a',
			filesize: 10000000,
		});

		const req = createMockRequest({
			method: 'POST',
			body: {
				accessToken: 'token123',
				hash: 'abc',
				fileId: 1,
				link: 'https://link',
			},
		});
		const res = createMockResponse();

		await handler(req, res);

		expect((res._getData() as Record<string, unknown>).mimeType).toBe('audio/mp4');
	});

	it('returns correct MIME type for .wav', async () => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		rdMocks.unrestrictLink.mockResolvedValue({
			download: 'https://example.com/song.wav',
			filename: 'song.wav',
			filesize: 60000000,
		});

		const req = createMockRequest({
			method: 'POST',
			body: {
				accessToken: 'token123',
				hash: 'abc',
				fileId: 1,
				link: 'https://link',
			},
		});
		const res = createMockResponse();

		await handler(req, res);

		expect((res._getData() as Record<string, unknown>).mimeType).toBe('audio/wav');
	});

	it('defaults to audio/mpeg for unknown extensions', async () => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		rdMocks.unrestrictLink.mockResolvedValue({
			download: 'https://example.com/song.xyz',
			filename: 'song.xyz',
			filesize: 5000000,
		});

		const req = createMockRequest({
			method: 'POST',
			body: {
				accessToken: 'token123',
				hash: 'abc',
				fileId: 1,
				link: 'https://link',
			},
		});
		const res = createMockResponse();

		await handler(req, res);

		expect((res._getData() as Record<string, unknown>).mimeType).toBe('audio/mpeg');
	});

	it('returns axios error code when available', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.spyOn(console, 'log').mockImplementation(() => {});
		const axiosError = {
			response: {
				status: 503,
				data: {
					error: 'service_unavailable',
					error_code: 35,
				},
			},
		};
		rdMocks.addHashAsMagnet.mockRejectedValue(axiosError);

		const req = createMockRequest({
			method: 'POST',
			body: { accessToken: 'token123', hash: 'abc', fileId: 1 },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(502);
		expect(res._getData()).toEqual({
			error: "Real-Debrid couldn't start this track right now. Try again in a while.",
			errorCode: 35,
		});
	});

	it('passes client IP to unrestrictLink', async () => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		clientIpMocks.getClientIpFromRequest.mockReturnValue('192.168.1.100');
		rdMocks.unrestrictLink.mockResolvedValue({
			download: 'https://example.com/song.mp3',
			filename: 'song.mp3',
			filesize: 5000000,
		});

		const req = createMockRequest({
			method: 'POST',
			body: {
				accessToken: 'token123',
				hash: 'abc',
				fileId: 1,
				link: 'https://link',
			},
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(rdMocks.unrestrictLink).toHaveBeenCalledWith(
			'token123',
			'https://link',
			'192.168.1.100',
			false
		);
	});

	it('selects only media files via isVideo filter', async () => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		selectableMocks.isVideo
			.mockReturnValueOnce(true)
			.mockReturnValueOnce(false)
			.mockReturnValueOnce(true);
		rdMocks.addHashAsMagnet.mockResolvedValue('torrent-filter');
		rdMocks.getTorrentInfo
			.mockResolvedValueOnce({
				files: [
					{ id: 1, selected: false },
					{ id: 2, selected: false },
					{ id: 3, selected: false },
				],
				status: 'waiting_files_selection',
				links: [],
			})
			.mockResolvedValueOnce({
				files: [
					{ id: 1, selected: true },
					{ id: 3, selected: true },
				],
				status: 'downloaded',
				links: ['https://rd.link/1', 'https://rd.link/3'],
			});
		rdMocks.selectFiles.mockResolvedValue(undefined);
		rdMocks.unrestrictLink.mockResolvedValue({
			download: 'https://example.com/track.mp3',
			filename: 'track.mp3',
			filesize: 5000000,
		});
		rdMocks.deleteTorrent.mockResolvedValue(undefined);

		const req = createMockRequest({
			method: 'POST',
			body: { accessToken: 'token123', hash: 'abc', fileId: 1 },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(rdMocks.selectFiles).toHaveBeenCalledWith(
			'token123',
			'torrent-filter',
			['1', '3'],
			false
		);
	});

	it('falls back to all files if no media files found', async () => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		selectableMocks.isVideo.mockReturnValue(false);
		rdMocks.addHashAsMagnet.mockResolvedValue('torrent-no-media');
		rdMocks.getTorrentInfo
			.mockResolvedValueOnce({
				files: [
					{ id: 1, selected: false },
					{ id: 2, selected: false },
				],
				status: 'waiting_files_selection',
				links: [],
			})
			.mockResolvedValueOnce({
				files: [
					{ id: 1, selected: true },
					{ id: 2, selected: true },
				],
				status: 'downloaded',
				links: ['https://rd.link/1', 'https://rd.link/2'],
			});
		rdMocks.selectFiles.mockResolvedValue(undefined);
		rdMocks.unrestrictLink.mockResolvedValue({
			download: 'https://example.com/track.mp3',
			filename: 'track.mp3',
			filesize: 5000000,
		});
		rdMocks.deleteTorrent.mockResolvedValue(undefined);

		const req = createMockRequest({
			method: 'POST',
			body: { accessToken: 'token123', hash: 'abc', fileId: 1 },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(rdMocks.selectFiles).toHaveBeenCalledWith(
			'token123',
			'torrent-no-media',
			['1', '2'],
			false
		);
	});
});
