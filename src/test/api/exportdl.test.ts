import handler, { exportDownloadLinks } from '@/pages/api/exportdl';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetTorrentInfo, mockUnrestrictLink } = vi.hoisted(() => ({
	mockGetTorrentInfo: vi.fn(),
	mockUnrestrictLink: vi.fn(),
}));

vi.mock('@/services/realDebrid', () => ({
	getTorrentInfo: mockGetTorrentInfo,
	unrestrictLink: mockUnrestrictLink,
}));

describe('/api/exportdl', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetTorrentInfo.mockResolvedValue({
			original_filename: 'My.Movie.2024',
			links: ['https://rd/link-1', 'https://rd/link-2'],
		});
		mockUnrestrictLink.mockResolvedValue({ download: 'https://cdn/file.mkv' });
	});

	it('returns a text file with unrestricted links', async () => {
		const req = createMockRequest({
			query: { token: 'tok', torrentId: '123' },
			headers: { 'x-real-ip': '127.0.0.1' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(mockGetTorrentInfo).toHaveBeenCalledWith('tok', '123', false);
		expect(mockUnrestrictLink).toHaveBeenCalledTimes(2);
		expect(res.setHeader).toHaveBeenCalledWith(
			'Content-Disposition',
			expect.stringContaining('My.Movie.2024-links.txt')
		);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.send).toHaveBeenCalledWith(expect.stringContaining('https://cdn/file.mkv'));
	});

	it('returns 500 when no links can be exported', async () => {
		mockGetTorrentInfo.mockRejectedValue(new Error('rd down'));
		const req = createMockRequest({
			query: { token: 'tok', torrentId: '123' },
			headers: { 'x-real-ip': '127.0.0.1' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(500);
		expect(res.json).toHaveBeenCalledWith({
			error: 'No download links found for torrent 123',
		});
	});
});

describe('exportDownloadLinks helper', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetTorrentInfo.mockResolvedValue({
			original_filename: 'Movie',
			links: ['https://rd/link'],
		});
		mockUnrestrictLink.mockResolvedValue({ download: 'https://cdn/file' });
	});

	it('returns filename and newline separated download URLs', async () => {
		const [filename, links] = await exportDownloadLinks('tok', 'id', '127.0.0.1');
		expect(filename).toBe('Movie');
		expect(links.trim()).toBe('https://cdn/file');
	});

	it('swallows errors and returns empty strings', async () => {
		mockGetTorrentInfo.mockRejectedValue(new Error('rd down'));
		const [filename, links] = await exportDownloadLinks('tok', 'id', '127.0.0.1');
		expect(filename).toBe('');
		expect(links).toBe('');
	});
});
