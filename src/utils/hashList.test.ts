import { UserTorrent, UserTorrentStatus } from '@/torrent/userTorrent';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateHashList, handleShare } from './hashList';

// Mock dependencies
vi.mock('@/services/hashlists', () => ({
	createShortUrl: vi.fn(),
}));

vi.mock('react-hot-toast', () => {
	const toastMock = Object.assign(vi.fn(), {
		error: vi.fn(),
	});
	return { default: toastMock };
});

vi.mock('lz-string', () => ({
	default: {
		compressToEncodedURIComponent: vi.fn(),
	},
}));

vi.mock('./toastOptions', () => ({
	libraryToastOptions: { position: 'top-right' },
}));

import { createShortUrl } from '@/services/hashlists';
import lzString from 'lz-string';
import toast from 'react-hot-toast';

describe('hashList utils', () => {
	const mockTorrent: UserTorrent = {
		id: '123',
		filename: 'test-movie.mp4',
		title: 'Test Movie',
		hash: 'abc123',
		bytes: 1024000,
		progress: 100,
		status: UserTorrentStatus.finished,
		serviceStatus: 'available',
		added: new Date(),
		mediaType: 'movie',
		links: [],
		selectedFiles: [],
		seeders: 0,
		speed: 0,
	};

	beforeEach(() => {
		vi.clearAllMocks();
		// Mock window object
		Object.defineProperty(window, 'location', {
			value: {
				protocol: 'https:',
				host: 'example.com',
			},
			writable: true,
		});
		Object.defineProperty(window, 'open', {
			value: vi.fn(),
			writable: true,
		});
	});

	describe('generateHashList', () => {
		it('leaves out a Premiumize row that has no info hash', async () => {
			// transfer/list never reports a hash, and job/src cannot recover one
			// once the transfer record is gone - so these rows would be shared as
			// an empty hash that resolves to nothing anywhere.
			const premiumizeOrphan: UserTorrent = {
				...mockTorrent,
				id: 'pm:fhp92DFAmxWqvNFC_IzGbWw',
				filename: 'Old Folder',
				hash: '',
			};
			vi.mocked(lzString.compressToEncodedURIComponent).mockReturnValue('compressed-data');
			vi.mocked(createShortUrl).mockResolvedValue('https://short.url/abc123');

			await generateHashList('Mixed', [mockTorrent, premiumizeOrphan]);

			expect(lzString.compressToEncodedURIComponent).toHaveBeenCalledWith(
				JSON.stringify({
					title: 'Mixed',
					torrents: [
						{
							filename: mockTorrent.filename,
							hash: mockTorrent.hash,
							bytes: mockTorrent.bytes,
						},
					],
				})
			);
		});

		it('leaves out an Offcloud row created from a plain HTTP URL', async () => {
			// Offcloud is a remote-download service too: a `/cloud` submission of an
			// ordinary http URL has no info hash anywhere in it, and `originalLink`
			// carries a URL rather than a magnet or `<hash>.torrent`.
			const offcloudDirectDownload: UserTorrent = {
				...mockTorrent,
				id: 'oc:68b7f0c1e4b0a1',
				filename: 'some-file.mkv',
				hash: '',
			};
			vi.mocked(lzString.compressToEncodedURIComponent).mockReturnValue('compressed-data');
			vi.mocked(createShortUrl).mockResolvedValue('https://short.url/abc123');

			await generateHashList('Mixed', [mockTorrent, offcloudDirectDownload]);

			expect(lzString.compressToEncodedURIComponent).toHaveBeenCalledWith(
				JSON.stringify({
					title: 'Mixed',
					torrents: [
						{
							filename: mockTorrent.filename,
							hash: mockTorrent.hash,
							bytes: mockTorrent.bytes,
						},
					],
				})
			);
		});

		it('shares a Debrid-Link row, which always carries a hash', async () => {
			// `hashString` rides on every seedbox row Debrid-Link returns, so
			// unlike Premiumize and Offcloud there is no hashless case here and no
			// guard was added for one. This is the test that says so.
			const debridLinkRow: UserTorrent = {
				...mockTorrent,
				id: 'dl:seed-1',
				filename: 'Big Buck Bunny',
				hash: 'dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c',
				bytes: 276_134_947,
			};
			vi.mocked(lzString.compressToEncodedURIComponent).mockReturnValue('compressed-data');
			vi.mocked(createShortUrl).mockResolvedValue('https://short.url/abc123');

			await generateHashList('Mixed', [mockTorrent, debridLinkRow]);

			expect(lzString.compressToEncodedURIComponent).toHaveBeenCalledWith(
				JSON.stringify({
					title: 'Mixed',
					torrents: [
						{
							filename: mockTorrent.filename,
							hash: mockTorrent.hash,
							bytes: mockTorrent.bytes,
						},
						{
							filename: debridLinkRow.filename,
							hash: debridLinkRow.hash,
							bytes: debridLinkRow.bytes,
						},
					],
				})
			);
		});

		it('should generate hash list successfully', async () => {
			const title = 'Test Collection';
			const filteredList = [mockTorrent];
			const shortUrl = 'https://short.url/abc123';

			vi.mocked(lzString.compressToEncodedURIComponent).mockReturnValue('compressed-data');
			vi.mocked(createShortUrl).mockResolvedValue(shortUrl);

			await generateHashList(title, filteredList);

			expect(toast).toHaveBeenCalledWith(
				'Hash list may 404 for 1-2 minutes—refresh if needed.',
				expect.objectContaining({ duration: 60000 })
			);
			expect(lzString.compressToEncodedURIComponent).toHaveBeenCalledWith(
				JSON.stringify({
					title,
					torrents: [
						{
							filename: mockTorrent.filename,
							hash: mockTorrent.hash,
							bytes: mockTorrent.bytes,
						},
					],
				})
			);
			expect(createShortUrl).toHaveBeenCalledWith(
				'https://example.com/hashlist#compressed-data'
			);
			expect(window.open).toHaveBeenCalledWith(shortUrl);
		});

		it('leaves TorBox web downloads out of the shared list', async () => {
			const webDownload: UserTorrent = {
				...mockTorrent,
				id: 'tb:w77',
				filename: 'web-download.mkv',
				hash: 'd41d8cd98f00b204e9800998ecf8427e',
			};
			vi.mocked(lzString.compressToEncodedURIComponent).mockReturnValue('compressed-data');
			vi.mocked(createShortUrl).mockResolvedValue('https://short.url/abc123');

			await generateHashList('Mixed', [mockTorrent, webDownload]);

			expect(lzString.compressToEncodedURIComponent).toHaveBeenCalledWith(
				JSON.stringify({
					title: 'Mixed',
					torrents: [
						{
							filename: mockTorrent.filename,
							hash: mockTorrent.hash,
							bytes: mockTorrent.bytes,
						},
					],
				})
			);
			expect(toast).toHaveBeenCalledWith(
				'Skipping 1 item with no info hash — they cannot be shared.',
				expect.anything()
			);
		});

		it('refuses to build a list made only of web downloads', async () => {
			const webDownload: UserTorrent = {
				...mockTorrent,
				id: 'tb:w77',
				hash: 'd41d8cd98f00b204e9800998ecf8427e',
			};

			await generateHashList('Only web', [webDownload]);

			expect(createShortUrl).not.toHaveBeenCalled();
			expect(toast.error).toHaveBeenCalledWith(
				'Nothing to share — none of those have an info hash.',
				expect.anything()
			);
		});

		it('should handle empty torrent list', async () => {
			const title = 'Empty Collection';
			const filteredList: UserTorrent[] = [];
			const shortUrl = 'https://short.url/empty';

			vi.mocked(lzString.compressToEncodedURIComponent).mockReturnValue('empty-data');
			vi.mocked(createShortUrl).mockResolvedValue(shortUrl);

			await generateHashList(title, filteredList);

			expect(lzString.compressToEncodedURIComponent).toHaveBeenCalledWith(
				JSON.stringify({
					title,
					torrents: [],
				})
			);
			expect(window.open).toHaveBeenCalledWith(shortUrl);
		});

		it('should handle multiple torrents', async () => {
			const title = 'Multi Torrent Collection';
			const mockTorrent2: UserTorrent = {
				...mockTorrent,
				id: '456',
				filename: 'test-movie-2.mp4',
				title: 'Test Movie 2',
				hash: 'def456',
			};
			const filteredList = [mockTorrent, mockTorrent2];
			const shortUrl = 'https://short.url/multi';

			vi.mocked(lzString.compressToEncodedURIComponent).mockReturnValue('multi-data');
			vi.mocked(createShortUrl).mockResolvedValue(shortUrl);

			await generateHashList(title, filteredList);

			expect(lzString.compressToEncodedURIComponent).toHaveBeenCalledWith(
				JSON.stringify({
					title,
					torrents: [
						{
							filename: mockTorrent.filename,
							hash: mockTorrent.hash,
							bytes: mockTorrent.bytes,
						},
						{
							filename: mockTorrent2.filename,
							hash: mockTorrent2.hash,
							bytes: mockTorrent2.bytes,
						},
					],
				})
			);
			expect(window.open).toHaveBeenCalledWith(shortUrl);
		});

		it('should handle createShortUrl failure', async () => {
			const title = 'Failed Collection';
			const filteredList = [mockTorrent];
			const error = new Error('Failed to create short URL');

			vi.mocked(lzString.compressToEncodedURIComponent).mockReturnValue('data');
			vi.mocked(createShortUrl).mockRejectedValue(error);

			await generateHashList(title, filteredList);

			expect(toast.error).toHaveBeenCalledWith(
				'Failed to generate hash list; try again soon.',
				expect.any(Object)
			);
			expect(console.error).toHaveBeenCalledWith(error);
			expect(window.open).not.toHaveBeenCalled();
		});

		it('should handle compression failure', async () => {
			const title = 'Compression Fail';
			const filteredList = [mockTorrent];
			const error = new Error('Compression failed');

			vi.mocked(lzString.compressToEncodedURIComponent).mockImplementation(() => {
				throw error;
			});

			await generateHashList(title, filteredList);

			expect(toast.error).toHaveBeenCalledWith(
				'Failed to generate hash list; try again soon.',
				expect.any(Object)
			);
			expect(console.error).toHaveBeenCalledWith(error);
			expect(createShortUrl).not.toHaveBeenCalled();
		});

		it('should handle window.open failure gracefully', async () => {
			const title = 'Window Open Fail';
			const filteredList = [mockTorrent];
			const shortUrl = 'https://short.url/fail';

			vi.mocked(lzString.compressToEncodedURIComponent).mockReturnValue('data');
			vi.mocked(createShortUrl).mockResolvedValue(shortUrl);
			vi.mocked(window.open).mockImplementation(() => {
				throw new Error('Popup blocked');
			});

			// Should not throw error
			await expect(generateHashList(title, filteredList)).resolves.not.toThrow();
		});
	});

	describe('handleShare', () => {
		it('should generate share URL for single torrent', async () => {
			const torrent = {
				filename: mockTorrent.filename,
				hash: mockTorrent.hash,
				bytes: mockTorrent.bytes,
			};

			vi.mocked(lzString.compressToEncodedURIComponent).mockReturnValue('share-data');

			const result = await handleShare(torrent);

			expect(lzString.compressToEncodedURIComponent).toHaveBeenCalledWith(
				JSON.stringify([
					{
						filename: torrent.filename,
						hash: torrent.hash,
						bytes: torrent.bytes,
					},
				])
			);
			expect(result).toBe('/hashlist#share-data');
		});

		it('should handle different torrent data', async () => {
			const torrent = {
				filename: 'different-movie.mkv',
				hash: 'xyz789',
				bytes: 2048000,
			};

			vi.mocked(lzString.compressToEncodedURIComponent).mockReturnValue('different-data');

			const result = await handleShare(torrent);

			expect(lzString.compressToEncodedURIComponent).toHaveBeenCalledWith(
				JSON.stringify([
					{
						filename: torrent.filename,
						hash: torrent.hash,
						bytes: torrent.bytes,
					},
				])
			);
			expect(result).toBe('/hashlist#different-data');
		});

		it('should handle empty filename', async () => {
			const torrent = {
				filename: '',
				hash: 'empty123',
				bytes: 0,
			};

			vi.mocked(lzString.compressToEncodedURIComponent).mockReturnValue('empty-data');

			const result = await handleShare(torrent);

			expect(result).toBe('/hashlist#empty-data');
		});

		it('should handle special characters in filename', async () => {
			const torrent = {
				filename: 'Movie (2023) [1080p].mp4',
				hash: 'special123',
				bytes: 1500000,
			};

			vi.mocked(lzString.compressToEncodedURIComponent).mockReturnValue('special-data');

			const result = await handleShare(torrent);

			expect(result).toBe('/hashlist#special-data');
		});

		it('should handle large byte values', async () => {
			const torrent = {
				filename: 'large-file.iso',
				hash: 'large123',
				bytes: Number.MAX_SAFE_INTEGER,
			};

			vi.mocked(lzString.compressToEncodedURIComponent).mockReturnValue('large-data');

			const result = await handleShare(torrent);

			expect(result).toBe('/hashlist#large-data');
		});
	});
});
