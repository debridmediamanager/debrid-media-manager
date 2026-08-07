import { MagnetStatus, getMagnetStatus } from '@/services/allDebrid';
import { getUserTorrentsList } from '@/services/realDebrid';
import { getTorrentList, getWebDownloadList } from '@/services/torbox';
import { TorBoxTorrentInfo, TorBoxWebDownload, UserTorrentResponse } from '@/services/types';
import { UserTorrentStatus } from '@/torrent/userTorrent';
import { ParsedFilename } from '@ctrl/video-filename-parser';
import toast from 'react-hot-toast';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	convertToTbUserTorrent,
	convertToTbWebDownloadUserTorrent,
	convertToUserTorrent,
	fetchAllDebrid,
	fetchRealDebrid,
	fetchTorBox,
	getRdStatus,
} from './fetchTorrents';

// Mock dependencies
vi.mock('@/services/allDebrid');
vi.mock('@/services/realDebrid');
vi.mock('@/services/torbox');
vi.mock('react-hot-toast', () => ({
	default: {
		error: vi.fn(),
	},
}));
vi.mock('./mediaId', () => ({
	getMediaId: vi.fn((info: ParsedFilename, mediaType: string) => {
		if (info?.title) return `${info.title} (${info.year || 'N/A'})`;
		return null;
	}),
}));
vi.mock('./mediaType', () => ({
	getTypeByNameAndFileCount: vi.fn((filename: string) => {
		if (filename.includes('S01E01') || filename.includes('season')) return 'tv';
		return 'movie';
	}),
}));
vi.mock('./selectable', () => ({
	checkArithmeticSequenceInFilenames: vi.fn((filenames: string[]) => {
		return filenames.some((f) => /E\d+/i.test(f));
	}),
	isVideo: vi.fn((file: { path: string }) => {
		const videoExts = ['.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm'];
		return videoExts.some((ext) => file.path.toLowerCase().endsWith(ext));
	}),
}));

describe('fetchTorrents utilities', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('fetchRealDebrid', () => {
		const rdKey = 'test-rd-key';
		const callback = vi.fn();

		beforeEach(() => {
			callback.mockClear();
		});

		it('should fetch torrents successfully with pagination', async () => {
			const mockTorrents: UserTorrentResponse[] = [
				{
					id: '123',
					filename: 'Movie.2024.1080p.mkv',
					hash: 'abc123',
					bytes: 1000000,
					status: 'downloaded',
					added: '2024-01-01T00:00:00Z',
					links: ['link1', 'link2'],
					seeders: 10,
					speed: 0,
					progress: 100,
				} as any,
			];

			// Mock initial request
			vi.mocked(getUserTorrentsList).mockResolvedValueOnce({
				data: mockTorrents,
				totalCount: 10000,
			});

			// Mock pagination requests
			for (let i = 0; i < 2; i++) {
				vi.mocked(getUserTorrentsList).mockResolvedValueOnce({
					data: Array(5000).fill(mockTorrents[0]),
					totalCount: 10000,
				});
			}

			await fetchRealDebrid(rdKey, callback);

			expect(getUserTorrentsList).toHaveBeenCalledWith(rdKey, 1, 1);
			expect(getUserTorrentsList).toHaveBeenCalledWith(rdKey, 5000, 1);
			expect(getUserTorrentsList).toHaveBeenCalledWith(rdKey, 5000, 2);
			expect(callback).toHaveBeenCalled();

			const torrents = callback.mock.calls[0][0];
			expect(torrents).toBeInstanceOf(Array);
			expect(torrents.length).toBeGreaterThan(0);
		});

		it('should handle empty torrent list', async () => {
			vi.mocked(getUserTorrentsList).mockResolvedValueOnce({
				data: [],
				totalCount: 0,
			});

			await fetchRealDebrid(rdKey, callback);

			expect(callback).toHaveBeenCalledWith([]);
			expect(toast.error).not.toHaveBeenCalled();
		});

		it('should handle custom limit', async () => {
			const mockTorrents: UserTorrentResponse[] = [
				{
					id: '456',
					filename: 'Show.S01E01.mkv',
					hash: 'def456',
					bytes: 2000000,
					status: 'downloading',
					added: '2024-01-02T00:00:00Z',
					links: ['link3'],
					seeders: 5,
					speed: 1000,
					progress: 50,
				} as any,
			];

			vi.mocked(getUserTorrentsList).mockResolvedValueOnce({
				data: mockTorrents,
				totalCount: 1,
			});

			await fetchRealDebrid(rdKey, callback, 1);

			expect(getUserTorrentsList).toHaveBeenCalledWith(rdKey, 1, 1);
			expect(callback).toHaveBeenCalled();
		});

		it('should handle API errors gracefully', async () => {
			vi.mocked(getUserTorrentsList).mockRejectedValueOnce(new Error('API Error'));

			await fetchRealDebrid(rdKey, callback);

			expect(callback).toHaveBeenCalledWith([]);
			expect(toast.error).toHaveBeenCalledWith('RD error: API Error', expect.any(Object));
		});

		it('should handle partial pagination failures', async () => {
			const mockTorrents: UserTorrentResponse[] = [
				{
					id: '789',
					filename: 'Test.mkv',
					hash: 'ghi789',
					bytes: 3000000,
					status: 'downloaded',
					added: '2024-01-03T00:00:00Z',
					links: ['link4'],
					seeders: 15,
					speed: 0,
					progress: 100,
				} as any,
			];

			vi.mocked(getUserTorrentsList)
				.mockResolvedValueOnce({ data: mockTorrents, totalCount: 10000 })
				.mockResolvedValueOnce({ data: mockTorrents, totalCount: 10000 })
				.mockRejectedValueOnce(new Error('Page 2 failed'));

			await fetchRealDebrid(rdKey, callback);

			// Should still process successful pages
			expect(callback).toHaveBeenCalled();
			const torrents = callback.mock.calls[0][0];
			expect(torrents.length).toBeGreaterThan(0);
		});
	});

	describe('convertToUserTorrent', () => {
		it('should convert RD torrent response to UserTorrent format', () => {
			const rdTorrent: UserTorrentResponse = {
				id: '123',
				filename: 'Movie.2024.1080p.mkv',
				hash: 'abc123',
				bytes: 1000000000,
				status: 'downloaded',
				added: '2024-01-01T00:00:00Z',
				links: ['https://example.com/file1'],
				seeders: 20,
				speed: 0,
				progress: 100,
			} as any;

			const result = convertToUserTorrent(rdTorrent);

			expect(result.id).toBe('rd:123');
			expect(result.filename).toBe('Movie.2024.1080p.mkv');
			expect(result.hash).toBe('abc123');
			expect(result.bytes).toBe(1000000000);
			expect(result.status).toBe(UserTorrentStatus.finished);
			expect(result.serviceStatus).toBe('downloaded');
			expect(result.mediaType).toBe('movie');
			expect(result.links).toEqual(['https://example.com/file1']);
			expect(result.seeders).toBe(20);
			expect(result.speed).toBe(0);
		});

		it('should handle TV show torrents', () => {
			const rdTorrent: UserTorrentResponse = {
				id: '456',
				filename: 'Show.S01E01.720p.mkv',
				hash: 'def456',
				bytes: 500000000,
				status: 'downloading',
				added: '2024-01-02T00:00:00Z',
				links: ['link1', 'link2'],
				seeders: 10,
				speed: 1000000,
				progress: 50,
			} as any;

			const result = convertToUserTorrent(rdTorrent);

			expect(result.mediaType).toBe('tv');
			expect(result.status).toBe(UserTorrentStatus.downloading);
			expect(result.serviceStatus).toBe('downloading');
		});

		it('should handle torrent with no seeders or speed', () => {
			const rdTorrent: UserTorrentResponse = {
				id: '789',
				filename: 'Test.mkv',
				hash: 'ghi789',
				bytes: 100000,
				status: 'queued',
				added: '2024-01-03T00:00:00Z',
				links: [],
			} as any;

			const result = convertToUserTorrent(rdTorrent);

			expect(result.seeders).toBe(0);
			expect(result.speed).toBe(0);
			expect(result.status).toBe(UserTorrentStatus.waiting);
		});

		it('should preserve the added timestamp without applying offsets', () => {
			const rdTorrent: UserTorrentResponse = {
				id: '999',
				filename: 'Test.mkv',
				hash: 'xyz999',
				bytes: 100000,
				status: 'downloaded',
				added: '2024-01-01T12:00:00Z',
				links: [],
			} as any;

			const result = convertToUserTorrent(rdTorrent);

			expect(result.added).toBeInstanceOf(Date);
			expect(result.added.toISOString()).toBe('2024-01-01T12:00:00.000Z');
		});

		it('should handle links with encoded characters', () => {
			const rdTorrent: UserTorrentResponse = {
				id: '111',
				filename: 'Test.mkv',
				hash: 'aaa111',
				bytes: 100000,
				status: 'downloaded',
				added: '2024-01-01T00:00:00Z',
				links: ['https://example.com/file%2Fwith%2Fslashes'],
			} as any;

			const result = convertToUserTorrent(rdTorrent);

			expect(result.links).toEqual(['https://example.com/file/with/slashes']);
		});
	});

	describe('getRdStatus', () => {
		it('should map RD statuses to UserTorrentStatus correctly', () => {
			const statusMappings = [
				{ input: 'magnet_conversion', expected: UserTorrentStatus.waiting },
				{ input: 'waiting_files_selection', expected: UserTorrentStatus.waiting },
				{ input: 'queued', expected: UserTorrentStatus.waiting },
				{ input: 'downloading', expected: UserTorrentStatus.downloading },
				{ input: 'compressing', expected: UserTorrentStatus.downloading },
				{ input: 'uploading', expected: UserTorrentStatus.downloading },
				{ input: 'downloaded', expected: UserTorrentStatus.finished },
				{ input: 'error', expected: UserTorrentStatus.error },
				{ input: 'unknown_status', expected: UserTorrentStatus.error },
			];

			statusMappings.forEach(({ input, expected }) => {
				const torrent = { status: input } as UserTorrentResponse;
				expect(getRdStatus(torrent)).toBe(expected);
			});
		});
	});

	describe('fetchAllDebrid', () => {
		const adKey = 'test-ad-key';
		const callback = vi.fn();

		beforeEach(() => {
			callback.mockClear();
		});

		it('logs lifecycle details during fetch', async () => {
			const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
			const mockMagnets: MagnetStatus[] = [
				{
					id: 1,
					filename: 'Movie.mkv',
					hash: 'hash',
					size: 1,
					statusCode: 4,
					uploadDate: 1704067200,
					links: [],
					seeders: 1,
					downloadSpeed: 0,
				} as any,
			];

			vi.mocked(getMagnetStatus).mockResolvedValueOnce({
				data: { magnets: mockMagnets },
			} as any);

			await fetchAllDebrid(adKey, callback);

			expect(logSpy).toHaveBeenCalledWith('[AllDebridFetch] start', {
				customLimit: null,
			});
			expect(logSpy).toHaveBeenCalledWith(
				'[AllDebridFetch] end',
				expect.objectContaining({ returned: 1 })
			);
			logSpy.mockRestore();
		});

		it('should fetch AD torrents successfully', async () => {
			const mockMagnets: MagnetStatus[] = [
				{
					id: 123,
					filename: 'Movie.2024.mkv',
					hash: 'abc123',
					size: 1000000000,
					statusCode: 4,
					uploadDate: 1704067200,
					links: [
						{
							filename: 'Movie.2024.mkv',
							size: 1000000000,
							link: 'https://example.com/1',
						},
					],
					seeders: 25,
					downloadSpeed: 0,
				} as any,
			];

			vi.mocked(getMagnetStatus).mockResolvedValueOnce({
				data: { magnets: mockMagnets },
			} as any);

			await fetchAllDebrid(adKey, callback);

			expect(getMagnetStatus).toHaveBeenCalledWith(adKey);
			expect(callback).toHaveBeenCalled();

			const torrents = callback.mock.calls[0][0];
			expect(torrents).toBeInstanceOf(Array);
			expect(torrents[0].id).toBe('ad:123');
			expect(torrents[0].filename).toBe('Movie.2024.mkv');
			expect(torrents[0].status).toBe(UserTorrentStatus.finished);
		});

		it('should handle empty magnet list', async () => {
			vi.mocked(getMagnetStatus).mockResolvedValueOnce({
				data: { magnets: [] },
			} as any);

			await fetchAllDebrid(adKey, callback);

			expect(callback).toHaveBeenCalledWith([]);
		});

		it('should handle custom limit', async () => {
			const mockMagnets: MagnetStatus[] = Array(10)
				.fill(null)
				.map(
					(_, i) =>
						({
							id: i,
							filename: `Movie${i}.mkv`,
							hash: `hash${i}`,
							size: 1000000,
							statusCode: 4,
							uploadDate: 1704067200,
							links: [],
							seeders: 10,
							downloadSpeed: 0,
						}) as any
				);

			vi.mocked(getMagnetStatus).mockResolvedValueOnce({
				data: { magnets: mockMagnets },
			} as any);

			await fetchAllDebrid(adKey, callback, 5);

			const torrents = callback.mock.calls[0][0];
			expect(torrents.length).toBe(5);
		});

		it('should handle API errors', async () => {
			vi.mocked(getMagnetStatus).mockRejectedValueOnce(new Error('API Error'));

			await fetchAllDebrid(adKey, callback);

			expect(callback).toHaveBeenCalledWith([]);
			expect(toast.error).toHaveBeenCalledWith('AD error: API Error', expect.any(Object));
		});

		it('should handle magnets with hash as filename', async () => {
			const mockMagnets: MagnetStatus[] = [
				{
					id: 456,
					filename: 'abc123def456',
					hash: 'abc123def456',
					size: 1000000,
					statusCode: 4,
					uploadDate: 1704067200,
					links: [
						{
							filename: 'actual-file.mkv',
							size: 1000000,
							link: 'https://example.com/1',
						},
					],
					seeders: 5,
					downloadSpeed: 0,
				} as any,
			];

			vi.mocked(getMagnetStatus).mockResolvedValueOnce({
				data: { magnets: mockMagnets },
			} as any);

			await fetchAllDebrid(adKey, callback);

			const torrents = callback.mock.calls[0][0];
			expect(torrents[0].filename).toBe('Magnet');
		});

		it('classifies magnets without playable files as other media type', async () => {
			const mockMagnets: MagnetStatus[] = [
				{
					id: 321,
					filename: 'Archive.Bundle',
					hash: 'hash321',
					size: 123456,
					statusCode: 4,
					uploadDate: 1704067200,
					links: [
						{ filename: 'README.txt', size: 1024, link: 'link1' },
						{ filename: 'manual.pdf', size: 2048, link: 'link2' },
					],
					seeders: 2,
					downloadSpeed: 0,
				} as any,
			];

			vi.mocked(getMagnetStatus).mockResolvedValueOnce({
				data: { magnets: mockMagnets },
			} as any);

			await fetchAllDebrid(adKey, callback);

			const torrents = callback.mock.calls[0][0];
			expect(torrents[0].mediaType).toBe('other');
			expect(torrents[0].title).toBe('Archive.Bundle');
		});

		it('should detect TV shows from episode patterns', async () => {
			const mockMagnets: MagnetStatus[] = [
				{
					id: 789,
					filename: 'Show.Name',
					hash: 'xyz789',
					size: 5000000000,
					statusCode: 4,
					uploadDate: 1704067200,
					links: [
						{ filename: 'Show.S01E01.mkv', size: 500000000, link: 'link1' },
						{ filename: 'Show.S01E02.mkv', size: 500000000, link: 'link2' },
						{ filename: 'Show.S01E03.mkv', size: 500000000, link: 'link3' },
					],
					seeders: 30,
					downloadSpeed: 0,
				} as any,
			];

			vi.mocked(getMagnetStatus).mockResolvedValueOnce({
				data: { magnets: mockMagnets },
			} as any);

			await fetchAllDebrid(adKey, callback);

			const torrents = callback.mock.calls[0][0];
			expect(torrents[0].mediaType).toBe('tv');
		});

		it('should handle different AD status codes', async () => {
			const statusTests = [
				{ statusCode: 0, expectedStatus: UserTorrentStatus.waiting, expectedProgress: 0 },
				{
					statusCode: 1,
					expectedStatus: UserTorrentStatus.downloading,
					expectedProgress: 50,
				},
				{
					statusCode: 2,
					expectedStatus: UserTorrentStatus.downloading,
					expectedProgress: 50,
				},
				{
					statusCode: 3,
					expectedStatus: UserTorrentStatus.downloading,
					expectedProgress: 50,
				},
				{
					statusCode: 4,
					expectedStatus: UserTorrentStatus.finished,
					expectedProgress: 100,
				},
				{ statusCode: 5, expectedStatus: UserTorrentStatus.error, expectedProgress: 0 },
			];

			for (const test of statusTests) {
				const mockMagnets: MagnetStatus[] = [
					{
						id: test.statusCode,
						filename: 'Test.mkv',
						hash: 'hash',
						size: 1000000,
						statusCode: test.statusCode,
						uploadDate: 1704067200,
						links: [],
						seeders: 10,
						downloadSpeed: 0,
						downloaded: 500000,
					} as any,
				];

				vi.mocked(getMagnetStatus).mockResolvedValueOnce({
					data: { magnets: mockMagnets },
				} as any);

				await fetchAllDebrid(adKey, callback);

				const torrents = callback.mock.calls[callback.mock.calls.length - 1][0];
				expect(torrents[0].status).toBe(test.expectedStatus);
				expect(torrents[0].progress).toBe(test.expectedProgress);
			}
		});
	});

	describe('convertToTbUserTorrent', () => {
		it('should convert TorBox torrent info to UserTorrent', () => {
			const tbInfo: TorBoxTorrentInfo = {
				id: 123,
				name: 'Movie.2024.1080p.mkv',
				size: 2000000000,
				progress: 100,
				download_state: 'finished',
				seeds: 15,
				download_speed: 0,
				created_at: '2024-01-01T00:00:00Z',
				hash: 'abc123xyz',
				files: [
					{
						name: 'Movie.2024.1080p.mkv',
						size: 2000000000,
						s3_path: 'https://s3.url/file1',
					},
				],
			} as any;

			const result = convertToTbUserTorrent(tbInfo);

			expect(result.id).toBe('tb:123');
			expect(result.filename).toBe('Movie.2024.1080p.mkv');
			expect(result.bytes).toBe(2000000000);
			expect(result.status).toBe(UserTorrentStatus.finished);
			expect(result.serviceStatus).toBe('finished');
			expect(result.progress).toBe(100);
			expect(result.seeders).toBe(15);
			expect(result.speed).toBe(0);
			expect(result.hash).toBe('abc123xyz');
			expect(result.mediaType).toBe('movie');
			expect(result.selectedFiles).toHaveLength(1);
			expect(result.selectedFiles[0].filename).toBe('Movie.2024.1080p.mkv');
			expect(result.links).toEqual(['https://s3.url/file1']);
		});

		it('should handle different TorBox download states', () => {
			const states = [
				{ input: 'queued', expected: UserTorrentStatus.waiting },
				{ input: 'checking', expected: UserTorrentStatus.waiting },
				{ input: 'downloading', expected: UserTorrentStatus.downloading },
				{ input: 'uploading', expected: UserTorrentStatus.downloading },
				{ input: 'finished', expected: UserTorrentStatus.finished },
				{ input: 'seeding', expected: UserTorrentStatus.finished },
				{ input: 'error', expected: UserTorrentStatus.error },
				{ input: 'unknown', expected: UserTorrentStatus.error },
			];

			states.forEach(({ input, expected }) => {
				const tbInfo: TorBoxTorrentInfo = {
					id: 1,
					name: 'Test.mkv',
					size: 1000000,
					progress: 50,
					download_state: input,
					seeds: 5,
					download_speed: 1000,
					created_at: '2024-01-01T00:00:00Z',
					hash: 'test',
					files: [],
				} as any;

				const result = convertToTbUserTorrent(tbInfo);
				expect(result.status).toBe(expected);
				expect(result.serviceStatus).toBe(input);
			});
		});

		it('should handle torrent with no files', () => {
			const tbInfo: TorBoxTorrentInfo = {
				id: 456,
				name: 'Empty.mkv',
				size: 0,
				progress: 0,
				download_state: 'queued',
				seeds: 0,
				download_speed: 0,
				created_at: '2024-01-01T00:00:00Z',
				hash: 'empty',
			} as any;

			const result = convertToTbUserTorrent(tbInfo);

			expect(result.selectedFiles).toEqual([]);
			expect(result.links).toEqual([]);
		});

		it('should handle TV show detection', () => {
			const tbInfo: TorBoxTorrentInfo = {
				id: 789,
				name: 'Show.S01E01.720p.mkv',
				size: 500000000,
				progress: 100,
				download_state: 'finished',
				seeds: 20,
				download_speed: 0,
				created_at: '2024-01-01T00:00:00Z',
				hash: 'tvshow',
				files: [
					{
						name: 'Show.S01E01.720p.mkv',
						size: 500000000,
						s3_path: 'https://s3.url/ep1',
					},
				],
			} as any;

			const result = convertToTbUserTorrent(tbInfo);

			expect(result.mediaType).toBe('tv');
		});

		it('detects TV shows based on file entries even if name lacks pattern', () => {
			const tbInfo: TorBoxTorrentInfo = {
				id: 555,
				name: 'Awesome.Collection',
				size: 1500000000,
				progress: 50,
				download_state: 'downloading',
				seeds: 8,
				download_speed: 2000,
				created_at: '2024-01-01T00:00:00Z',
				hash: 'pack555',
				files: [
					{ name: 'Awesome.S01E01.mkv', size: 500000000, s3_path: 'https://s3.url/a' },
					{ name: 'Awesome.S01E02.mkv', size: 500000000, s3_path: 'https://s3.url/b' },
				],
			} as any;

			const result = convertToTbUserTorrent(tbInfo);

			expect(result.mediaType).toBe('tv');
		});

		it('marks TorBox torrents without playable files as other', () => {
			const tbInfo: TorBoxTorrentInfo = {
				id: 556,
				name: 'Document.Set',
				size: 2048,
				progress: 10,
				download_state: 'queued',
				seeds: 1,
				download_speed: 0,
				created_at: '2024-01-01T00:00:00Z',
				hash: 'docs556',
				files: [
					{ name: 'Guide.txt', size: 1024, s3_path: 'https://s3.url/doc' },
					{ name: 'Cover.jpg', size: 1024, s3_path: 'https://s3.url/img' },
				],
			} as any;

			const result = convertToTbUserTorrent(tbInfo);

			expect(result.mediaType).toBe('other');
			expect(result.info).toBeUndefined();
		});

		it('should handle parse errors gracefully', () => {
			const tbInfo: TorBoxTorrentInfo = {
				id: 999,
				name: '!!!###$$$%%%',
				size: 1000,
				progress: 0,
				download_state: 'error',
				seeds: 0,
				download_speed: 0,
				created_at: '2024-01-01T00:00:00Z',
				hash: 'invalid',
				files: [],
			} as any;

			const result = convertToTbUserTorrent(tbInfo);

			expect(result.info).toBeUndefined();
			expect(result.title).toBe('!!!###$$$%%%');
		});

		it('should handle files without s3_path', () => {
			const tbInfo: TorBoxTorrentInfo = {
				id: 111,
				name: 'NoPath.mkv',
				size: 1000000,
				progress: 100,
				download_state: 'finished',
				seeds: 10,
				download_speed: 0,
				created_at: '2024-01-01T00:00:00Z',
				hash: 'nopath',
				files: [{ name: 'NoPath.mkv', size: 1000000 }],
			} as any;

			const result = convertToTbUserTorrent(tbInfo);

			expect(result.selectedFiles[0].link).toBe('');
			expect(result.links).toEqual([]);
		});
	});

	describe('RequestQueue (internal)', () => {
		it('should handle concurrent request limiting', async () => {
			const rdKey = 'test-rd-key';
			const callback = vi.fn();

			// Create a large number of pages to test concurrency
			const totalCount = 25000;
			const mockTorrent: UserTorrentResponse = {
				id: '1',
				filename: 'Test.mkv',
				hash: 'test',
				bytes: 1000000,
				status: 'downloaded',
				added: '2024-01-01T00:00:00Z',
				links: [],
				seeders: 10,
				speed: 0,
				progress: 100,
			} as any;

			// Mock initial request
			vi.mocked(getUserTorrentsList).mockResolvedValueOnce({
				data: [mockTorrent],
				totalCount,
			});

			// Mock pagination requests (5 pages total)
			for (let i = 0; i < 5; i++) {
				vi.mocked(getUserTorrentsList).mockResolvedValueOnce({
					data: Array(5000).fill(mockTorrent),
					totalCount,
				});
			}

			await fetchRealDebrid(rdKey, callback);

			// Should have made 6 calls total (1 initial + 5 pages)
			expect(getUserTorrentsList).toHaveBeenCalledTimes(6);
			expect(callback).toHaveBeenCalled();
		});

		it('should handle mixed success and failure in queue', async () => {
			const rdKey = 'test-rd-key';
			const callback = vi.fn();

			vi.mocked(getUserTorrentsList)
				.mockResolvedValueOnce({ data: [{ id: '1' } as any], totalCount: 15000 })
				.mockResolvedValueOnce({
					data: Array(5000).fill({ id: '2' } as any),
					totalCount: 15000,
				})
				.mockRejectedValueOnce(new Error('Page 2 failed'))
				.mockResolvedValueOnce({
					data: Array(5000).fill({ id: '3' } as any),
					totalCount: 15000,
				});

			await fetchRealDebrid(rdKey, callback);

			// Should still process successful responses
			expect(callback).toHaveBeenCalled();
			const torrents = callback.mock.calls[0][0];
			expect(torrents.length).toBeGreaterThan(0);
		});
	});

	describe('fetchTorBox', () => {
		it('logs lifecycle details during fetch', async () => {
			const tbKey = 'test-tb-key';
			const callback = vi.fn();
			const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
			const mockTorrentInfo: TorBoxTorrentInfo = {
				id: 1,
				name: 'Movie',
				size: 1,
				progress: 0,
				download_state: 'downloading',
				seeds: 1,
				download_speed: 0,
				created_at: '2024-01-01T00:00:00Z',
				hash: 'hash',
				files: [],
			} as any;

			vi.mocked(getTorrentList).mockResolvedValueOnce({
				success: true,
				data: [mockTorrentInfo],
			} as any);

			await fetchTorBox(tbKey, callback);

			expect(logSpy).toHaveBeenCalledWith('[TorBoxFetch] start', {
				customLimit: null,
			});
			expect(logSpy).toHaveBeenCalledWith(
				'[TorBoxFetch] end',
				expect.objectContaining({ returned: 1 })
			);
			logSpy.mockRestore();
		});

		it('should fetch torrents successfully', async () => {
			const tbKey = 'test-tb-key';
			const callback = vi.fn();
			const mockTorrentInfo: TorBoxTorrentInfo = {
				id: 123,
				name: 'Test Movie.mkv',
				size: 1000000,
				progress: 100,
				download_state: 'finished',
				seeds: 10,
				download_speed: 0,
				created_at: '2024-01-01T00:00:00Z',
				hash: 'testhash',
				files: [
					{ name: 'Test Movie.mkv', size: 1000000, s3_path: 'http://example.com/file' },
				],
			} as any;

			vi.mocked(getTorrentList).mockResolvedValue({
				success: true,
				data: [mockTorrentInfo],
			} as any);

			await fetchTorBox(tbKey, callback);

			expect(getTorrentList).toHaveBeenCalledWith(tbKey);
			expect(callback).toHaveBeenCalled();
			const torrents = callback.mock.calls[0][0];
			expect(torrents).toHaveLength(1);
			expect(torrents[0].id).toBe('tb:123');
			expect(torrents[0].filename).toBe('Test Movie.mkv');
		});

		it('should handle empty torrent list', async () => {
			const tbKey = 'test-tb-key';
			const callback = vi.fn();

			vi.mocked(getTorrentList).mockResolvedValue({
				success: true,
				data: [],
			} as any);

			await fetchTorBox(tbKey, callback);

			expect(callback).toHaveBeenCalledWith([]);
		});

		it('should handle API errors', async () => {
			const tbKey = 'test-tb-key';
			const callback = vi.fn();

			vi.mocked(getTorrentList).mockRejectedValue(new Error('API Error'));

			await fetchTorBox(tbKey, callback);

			expect(toast.error).toHaveBeenCalledWith('TorBox error: API Error', expect.any(Object));
			expect(callback).toHaveBeenCalledWith([]);
		});

		it('should apply custom limit', async () => {
			const tbKey = 'test-tb-key';
			const callback = vi.fn();
			const mockTorrents: TorBoxTorrentInfo[] = Array.from({ length: 10 }, (_, i) => ({
				id: i + 1,
				name: `Test Movie ${i + 1}.mkv`,
				size: 1000000,
				progress: 100,
				download_state: 'finished',
				seeds: 10,
				download_speed: 0,
				created_at: '2024-01-01T00:00:00Z',
				hash: `testhash${i}`,
				files: [{ name: `Test Movie ${i + 1}.mkv`, size: 1000000 }],
			})) as any[];

			vi.mocked(getTorrentList).mockResolvedValue({
				success: true,
				data: mockTorrents,
			} as any);

			await fetchTorBox(tbKey, callback, 5);

			expect(callback).toHaveBeenCalled();
			const torrents = callback.mock.calls[0][0];
			expect(torrents).toHaveLength(5);
		});

		describe('web downloads', () => {
			const webDownload: TorBoxWebDownload = {
				id: 77,
				name: 'Direct Movie.mkv',
				size: 2000000,
				progress: 100,
				download_state: 'completed',
				download_finished: true,
				download_speed: 0,
				created_at: '2024-01-01T00:00:00Z',
				hash: 'd'.repeat(32),
				files: [{ id: 0, name: 'Direct Movie.mkv', size: 2000000 }],
			} as any;

			it('merges web downloads into the library under a tb:w id', async () => {
				const callback = vi.fn();
				vi.mocked(getTorrentList).mockResolvedValue({ success: true, data: [] } as any);
				vi.mocked(getWebDownloadList).mockResolvedValue({
					success: true,
					data: [webDownload],
				} as any);

				await fetchTorBox('test-tb-key', callback);

				const torrents = callback.mock.calls[0][0];
				expect(torrents).toHaveLength(1);
				expect(torrents[0].id).toBe('tb:w77');
				expect(torrents[0].filename).toBe('Direct Movie.mkv');
				expect(torrents[0].status).toBe(UserTorrentStatus.finished);
				expect(torrents[0].seeders).toBe(0);
			});

			it('still returns torrents when the web download list fails', async () => {
				const callback = vi.fn();
				vi.mocked(getTorrentList).mockResolvedValue({
					success: true,
					data: [
						{
							id: 1,
							name: 'Movie.mkv',
							size: 1,
							progress: 100,
							download_state: 'finished',
							seeds: 1,
							download_speed: 0,
							created_at: '2024-01-01T00:00:00Z',
							hash: 'hash',
							files: [],
						},
					],
				} as any);
				vi.mocked(getWebDownloadList).mockRejectedValue(new Error('webdl down'));

				await fetchTorBox('test-tb-key', callback);

				const torrents = callback.mock.calls[0][0];
				expect(torrents).toHaveLength(1);
				expect(torrents[0].id).toBe('tb:1');
				expect(toast.error).not.toHaveBeenCalled();
			});

			it('applies the custom limit to web downloads too', async () => {
				const callback = vi.fn();
				vi.mocked(getTorrentList).mockResolvedValue({ success: true, data: [] } as any);
				vi.mocked(getWebDownloadList).mockResolvedValue({
					success: true,
					data: Array.from({ length: 10 }, (_, i) => ({
						...webDownload,
						id: i + 1,
						hash: `${i}`.padStart(32, 'a'),
					})),
				} as any);

				await fetchTorBox('test-tb-key', callback, 3);

				expect(callback.mock.calls[0][0]).toHaveLength(3);
			});
		});
	});

	describe('convertToTbWebDownloadUserTorrent', () => {
		it('pads the missing swarm fields so library display code is unchanged', () => {
			const result = convertToTbWebDownloadUserTorrent({
				id: 5,
				name: 'Some Movie 2021.mkv',
				size: 100,
				progress: 50,
				download_state: 'downloading',
				download_finished: false,
				download_speed: 10,
				created_at: '2024-01-01T00:00:00Z',
				hash: 'a'.repeat(32),
				files: [{ id: 0, name: 'Some Movie 2021.mkv', size: 100 }],
			} as any);

			expect(result.id).toBe('tb:w5');
			expect(result.seeders).toBe(0);
			expect(result.status).toBe(UserTorrentStatus.downloading);
			expect(result.tbData).toMatchObject({ seeds: 0, peers: 0, magnet: '' });
		});
	});
});
