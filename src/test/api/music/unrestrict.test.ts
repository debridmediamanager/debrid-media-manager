import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import handler from '@/pages/api/music/unrestrict';
import { createMockRequest, createMockResponse } from '@/test/utils/api';

beforeEach(() => {
	vi.clearAllMocks();
	clientIpMocks.getClientIpFromRequest.mockReturnValue('127.0.0.1');
	selectableMocks.isVideo.mockReturnValue(true);
});

describe('API /api/music/unrestrict', () => {
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
		expect(rdMocks.addHashAsMagnet).toHaveBeenCalledWith('token123', 'abc123', false);
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

	it('cleans up torrent on error', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.spyOn(console, 'log').mockImplementation(() => {});
		rdMocks.addHashAsMagnet.mockResolvedValue('torrent-id-err');
		rdMocks.getTorrentInfo.mockResolvedValue({
			files: [{ id: 1, selected: false }],
			status: 'error',
			links: [],
		});
		rdMocks.selectFiles.mockResolvedValue(undefined);
		rdMocks.deleteTorrent.mockResolvedValue(undefined);

		const req = createMockRequest({
			method: 'POST',
			body: { accessToken: 'token123', hash: 'bad123', fileId: 1 },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(500);
		expect(rdMocks.deleteTorrent).toHaveBeenCalledWith('token123', 'torrent-id-err', false);
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

		expect(res.status).toHaveBeenCalledWith(500);
		expect(res._getData()).toMatchObject({ error: 'Network error' });
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

		expect(res.status).toHaveBeenCalledWith(500);
		expect(res._getData()).toEqual({
			error: 'service_unavailable',
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
