import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getBiggestFileStreamUrl, getStreamUrl } from './getStreamUrl';

// Mock dependencies
vi.mock('@/services/realDebrid', () => ({
	addHashAsMagnet: vi.fn(),
	deleteTorrent: vi.fn(),
	getTorrentInfo: vi.fn(),
	unrestrictLink: vi.fn(),
}));

vi.mock('./addMagnet', () => ({
	handleSelectFilesInRd: vi.fn(),
}));

vi.mock('parse-torrent-title', () => ({
	default: {
		parse: vi.fn(),
	},
}));

import {
	addHashAsMagnet,
	deleteTorrent,
	getTorrentInfo,
	unrestrictLink,
} from '@/services/realDebrid';
import type { TorrentInfoResponse, UnrestrictResponse } from '@/services/types';
import ptt from 'parse-torrent-title';
import { handleSelectFilesInRd } from './addMagnet';

const createTorrentInfo = (overrides: Partial<TorrentInfoResponse>): TorrentInfoResponse => ({
	id: 'torrent-id',
	filename: 'test.torrent',
	original_filename: 'test.torrent',
	hash: 'hash',
	bytes: 0,
	original_bytes: 0,
	host: 'host',
	split: 0,
	progress: 100,
	status: 'finished',
	added: new Date(0).toISOString(),
	files: [],
	links: [],
	ended: new Date(0).toISOString(),
	speed: 0,
	seeders: 0,
	fake: false,
	...overrides,
});

const createUnrestrictResponse = (overrides: Partial<UnrestrictResponse>): UnrestrictResponse => ({
	id: 'unrestrict-id',
	filename: 'file.mp4',
	mimeType: 'video/mp4',
	filesize: 0,
	link: 'https://download.example.com/file.mp4',
	host: 'download.example.com',
	chunks: 1,
	crc: 0,
	download: 'https://stream.example.com/file.mp4',
	streamable: 1,
	...overrides,
});

describe('getStreamUrl', () => {
	const mockRdKey = 'test-rd-key';
	const mockHash = 'abc123';
	const mockFileId = 1;
	const mockIpAddress = '192.168.1.1';
	const mockTorrentId = 'rd123';

	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(console.error).mockImplementation(() => {});
	});

	it('should get stream URL successfully for movie', async () => {
		vi.mocked(addHashAsMagnet).mockResolvedValue(mockTorrentId);
		vi.mocked(handleSelectFilesInRd).mockResolvedValue(undefined);
		vi.mocked(getTorrentInfo).mockResolvedValue(
			createTorrentInfo({
				id: mockTorrentId,
				files: [
					{ id: 1, path: 'movie-1.mp4', selected: 1, bytes: 1024000000 },
					{ id: 2, path: 'movie-2.mp4', selected: 0, bytes: 500000000 },
				],
				// One link per *selected* file, which is what RD returns.
				links: ['link1'],
			})
		);
		vi.mocked(unrestrictLink).mockResolvedValue(
			createUnrestrictResponse({
				download: 'https://stream.example.com/movie.mp4',
				link: 'https://download.example.com/movie.mp4',
				filename: 'movie.mp4',
				filesize: 1024000000,
			})
		);
		vi.mocked(deleteTorrent).mockResolvedValue(undefined);

		const result = await getStreamUrl(mockRdKey, mockHash, mockFileId, mockIpAddress, 'movie');

		expect(result).toEqual([
			'https://stream.example.com/movie.mp4',
			'https://download.example.com/movie.mp4',
			-1,
			-1,
			977, // 1024000000 / 1024 / 1024 rounded
		]);
		expect(addHashAsMagnet).toHaveBeenCalledWith(mockRdKey, mockHash, false);
		expect(handleSelectFilesInRd).toHaveBeenCalledWith(mockRdKey, `rd:${mockTorrentId}`, false);
		expect(deleteTorrent).toHaveBeenCalledWith(mockRdKey, mockTorrentId, false);
	});

	it('should get stream URL successfully for TV show with season/episode info', async () => {
		vi.mocked(addHashAsMagnet).mockResolvedValue(mockTorrentId);
		vi.mocked(handleSelectFilesInRd).mockResolvedValue(undefined);
		vi.mocked(getTorrentInfo).mockResolvedValue(
			createTorrentInfo({
				id: mockTorrentId,
				files: [
					{
						id: 1,
						path: 'path/to/Show.S01E02.1080p.mp4',
						selected: 1,
						bytes: 500000000,
					},
				],
				links: ['link1'],
			})
		);
		vi.mocked(unrestrictLink).mockResolvedValue(
			createUnrestrictResponse({
				download: 'https://stream.example.com/episode.mp4',
				link: 'https://download.example.com/episode.mp4',
				filename: 'path/to/Show.S01E02.1080p.mp4',
				filesize: 500000000,
			})
		);
		vi.mocked(ptt.parse).mockReturnValue({
			title: 'Show',
			season: 1,
			episode: 2,
		});
		vi.mocked(deleteTorrent).mockResolvedValue(undefined);

		const result = await getStreamUrl(mockRdKey, mockHash, mockFileId, mockIpAddress, 'tv');

		expect(result).toEqual([
			'https://stream.example.com/episode.mp4',
			'https://download.example.com/episode.mp4',
			1,
			2,
			477, // 500000000 / 1024 / 1024 rounded
		]);
		expect(ptt.parse).toHaveBeenCalledWith('Show.S01E02.1080p.mp4');
	});

	it('refuses to cast when the requested file is not among the selected ones', async () => {
		vi.mocked(addHashAsMagnet).mockResolvedValue(mockTorrentId);
		vi.mocked(handleSelectFilesInRd).mockResolvedValue(undefined);
		vi.mocked(getTorrentInfo).mockResolvedValue(
			createTorrentInfo({
				id: mockTorrentId,
				files: [
					{ id: 1, path: 'movie-main.mp4', selected: 1, bytes: 1000000000 },
					{ id: 2, path: 'movie-alt.mp4', selected: 1, bytes: 500000000 },
				],
				links: ['link1', 'link2'],
			})
		);
		vi.mocked(unrestrictLink).mockResolvedValue(
			createUnrestrictResponse({
				download: 'https://stream.example.com/movie.mp4',
				link: 'https://download.example.com/movie.mp4',
				filename: 'movie.mp4',
				filesize: 1000000000,
			})
		);
		vi.mocked(deleteTorrent).mockResolvedValue(undefined);

		// File id 5 is not in the selected set. Falling back to links[0] would
		// silently cast movie-main.mp4 in its place - a wrong file, not an error.
		await expect(getStreamUrl(mockRdKey, mockHash, 5, mockIpAddress, 'movie')).rejects.toThrow(
			'file_not_selected'
		);
		expect(unrestrictLink).not.toHaveBeenCalled();
		expect(deleteTorrent).toHaveBeenCalledWith(mockRdKey, mockTorrentId, false);
	});

	// Regression: this used to test `mediaType === 'tv'`, so the anime cast route
	// - which passes 'anime' - never parsed anything. Every episode of a batch
	// then got the bare anidb id as its key and overwrote the one before it,
	// leaving a single row filed as a movie.
	it('parses season and episode for a non-tv episodic media type', async () => {
		vi.mocked(addHashAsMagnet).mockResolvedValue(mockTorrentId);
		vi.mocked(handleSelectFilesInRd).mockResolvedValue(undefined);
		vi.mocked(getTorrentInfo).mockResolvedValue(
			createTorrentInfo({
				id: mockTorrentId,
				files: [{ id: 1, path: 'Anime.S01E07.mkv', selected: 1, bytes: 1000 }],
				links: ['link1'],
			})
		);
		vi.mocked(unrestrictLink).mockResolvedValue(
			createUnrestrictResponse({ filename: 'Anime.S01E07.mkv', filesize: 1000 })
		);
		vi.mocked(deleteTorrent).mockResolvedValue(undefined);
		vi.mocked(ptt.parse).mockReturnValue({ season: 1, episode: 7 } as any);

		const [, , season, episode] = await getStreamUrl(
			mockRdKey,
			mockHash,
			1,
			mockIpAddress,
			'anime'
		);

		expect(ptt.parse).toHaveBeenCalledWith('Anime.S01E07.mkv');
		expect([season, episode]).toEqual([1, 7]);
	});

	it('should handle non-streamable links', async () => {
		vi.mocked(addHashAsMagnet).mockResolvedValue(mockTorrentId);
		vi.mocked(handleSelectFilesInRd).mockResolvedValue(undefined);
		vi.mocked(getTorrentInfo).mockResolvedValue(
			createTorrentInfo({
				id: mockTorrentId,
				files: [{ id: 1, path: 'file-1.mkv', selected: 1, bytes: 1000000000 }],
				links: ['link1'],
			})
		);
		vi.mocked(unrestrictLink).mockResolvedValue(
			createUnrestrictResponse({
				download: 'https://download.example.com/movie.mp4',
				link: 'https://download.example.com/movie.mp4',
				streamable: 0,
				filename: 'movie.mp4',
				filesize: 1000000000,
			})
		);
		vi.mocked(deleteTorrent).mockResolvedValue(undefined);

		await expect(
			getStreamUrl(mockRdKey, mockHash, mockFileId, mockIpAddress, 'movie')
		).rejects.toThrow('not streamable');
	});

	it('should handle errors during torrent info retrieval', async () => {
		const error = new Error('Torrent not found');
		vi.mocked(addHashAsMagnet).mockResolvedValue(mockTorrentId);
		vi.mocked(handleSelectFilesInRd).mockResolvedValue(undefined);
		vi.mocked(getTorrentInfo).mockRejectedValue(error);
		vi.mocked(deleteTorrent).mockResolvedValue(undefined);

		await expect(
			getStreamUrl(mockRdKey, mockHash, mockFileId, mockIpAddress, 'movie')
		).rejects.toThrow('Torrent not found');
		expect(console.error).toHaveBeenCalledWith('error after adding hash', error);
		expect(deleteTorrent).toHaveBeenCalledWith(mockRdKey, mockTorrentId, false);
	});

	it('should handle errors during magnet addition', async () => {
		const error = new Error('Invalid hash');
		vi.mocked(addHashAsMagnet).mockRejectedValue(error);

		await expect(
			getStreamUrl(mockRdKey, mockHash, mockFileId, mockIpAddress, 'movie')
		).rejects.toThrow('Invalid hash');
	});

	it('should handle errors during file selection', async () => {
		const error = new Error('File selection failed');
		vi.mocked(addHashAsMagnet).mockResolvedValue(mockTorrentId);
		vi.mocked(handleSelectFilesInRd).mockRejectedValue(error);
		vi.mocked(deleteTorrent).mockResolvedValue(undefined);

		await expect(
			getStreamUrl(mockRdKey, mockHash, mockFileId, mockIpAddress, 'movie')
		).rejects.toThrow('File selection failed');
		expect(console.error).toHaveBeenCalledWith('error after adding hash', error);
		expect(deleteTorrent).toHaveBeenCalledWith(mockRdKey, mockTorrentId, false);
	});

	it('should handle errors during link unrestriction', async () => {
		const error = new Error('Unrestriction failed');
		vi.mocked(addHashAsMagnet).mockResolvedValue(mockTorrentId);
		vi.mocked(handleSelectFilesInRd).mockResolvedValue(undefined);
		vi.mocked(getTorrentInfo).mockResolvedValue(
			createTorrentInfo({
				id: mockTorrentId,
				files: [{ id: 1, path: 'file-1.mkv', selected: 1, bytes: 1000000000 }],
				links: ['link1'],
			})
		);
		vi.mocked(unrestrictLink).mockRejectedValue(error);
		vi.mocked(deleteTorrent).mockResolvedValue(undefined);

		await expect(
			getStreamUrl(mockRdKey, mockHash, mockFileId, mockIpAddress, 'movie')
		).rejects.toThrow('Unrestriction failed');
		expect(console.error).toHaveBeenCalledWith('error after adding hash', error);
		expect(deleteTorrent).toHaveBeenCalledWith(mockRdKey, mockTorrentId, false);
	});

	it('should handle empty filename for TV shows', async () => {
		vi.mocked(addHashAsMagnet).mockResolvedValue(mockTorrentId);
		vi.mocked(handleSelectFilesInRd).mockResolvedValue(undefined);
		vi.mocked(getTorrentInfo).mockResolvedValue(
			createTorrentInfo({
				id: mockTorrentId,
				files: [{ id: 1, path: 'file-1.mkv', selected: 1, bytes: 500000000 }],
				links: ['link1'],
			})
		);
		vi.mocked(unrestrictLink).mockResolvedValue(
			createUnrestrictResponse({
				download: 'https://stream.example.com/episode.mp4',
				link: 'https://download.example.com/episode.mp4',
				filename: '', // Empty filename
				filesize: 500000000,
			})
		);
		vi.mocked(ptt.parse).mockReturnValue({ title: '' });
		vi.mocked(deleteTorrent).mockResolvedValue(undefined);

		const result = await getStreamUrl(mockRdKey, mockHash, mockFileId, mockIpAddress, 'tv');

		expect(result).toEqual([
			'https://stream.example.com/episode.mp4',
			'https://download.example.com/episode.mp4',
			-1,
			-1,
			477,
		]);
		expect(ptt.parse).toHaveBeenCalledWith('');
	});
});

describe('getBiggestFileStreamUrl', () => {
	const mockRdKey = 'test-rd-key';
	const mockHash = 'abc123';
	const mockIpAddress = '192.168.1.1';
	const mockTorrentId = 'rd123';

	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(console.error).mockImplementation(() => {});
	});

	it('should get biggest file stream URL successfully', async () => {
		vi.mocked(addHashAsMagnet).mockResolvedValue(mockTorrentId);
		vi.mocked(handleSelectFilesInRd).mockResolvedValue(undefined);
		vi.mocked(getTorrentInfo).mockResolvedValue(
			createTorrentInfo({
				id: mockTorrentId,
				files: [
					{ id: 1, path: 'file-1.mkv', selected: 1, bytes: 500000000 },
					{ id: 2, path: 'file-2.mkv', selected: 1, bytes: 2000000000 }, // Biggest
					{ id: 3, path: 'file-3.mkv', selected: 0, bytes: 1000000000 },
				],
				// One link per *selected* file, which is what RD returns.
				links: ['link1', 'link2'],
			})
		);
		vi.mocked(unrestrictLink).mockResolvedValue(
			createUnrestrictResponse({
				download: 'https://stream.example.com/biggest.mp4',
				link: 'https://download.example.com/biggest.mp4',
				filename: 'biggest.mp4',
				filesize: 2000000000,
			})
		);
		vi.mocked(deleteTorrent).mockResolvedValue(undefined);

		const result = await getBiggestFileStreamUrl(mockRdKey, mockHash, mockIpAddress);

		expect(result).toEqual([
			'https://stream.example.com/biggest.mp4',
			'https://download.example.com/biggest.mp4',
			1907, // 2000000000 / 1024 / 1024 rounded
		]);
		expect(addHashAsMagnet).toHaveBeenCalledWith(mockRdKey, mockHash, false);
		expect(unrestrictLink).toHaveBeenCalledWith(mockRdKey, 'link2', mockIpAddress, false);
		expect(deleteTorrent).toHaveBeenCalledWith(mockRdKey, mockTorrentId, false);
	});

	it('should handle single file torrents', async () => {
		vi.mocked(addHashAsMagnet).mockResolvedValue(mockTorrentId);
		vi.mocked(handleSelectFilesInRd).mockResolvedValue(undefined);
		vi.mocked(getTorrentInfo).mockResolvedValue(
			createTorrentInfo({
				id: mockTorrentId,
				files: [{ id: 1, path: 'file-1.mkv', selected: 1, bytes: 1000000000 }],
				links: ['link1'],
			})
		);
		vi.mocked(unrestrictLink).mockResolvedValue(
			createUnrestrictResponse({
				download: 'https://stream.example.com/single.mp4',
				link: 'https://download.example.com/single.mp4',
				filename: 'single.mp4',
				filesize: 1000000000,
			})
		);
		vi.mocked(deleteTorrent).mockResolvedValue(undefined);

		const result = await getBiggestFileStreamUrl(mockRdKey, mockHash, mockIpAddress);

		expect(result).toEqual([
			'https://stream.example.com/single.mp4',
			'https://download.example.com/single.mp4',
			954,
		]);
	});

	it('should handle errors during biggest file retrieval', async () => {
		const error = new Error('Failed to get torrent info');
		vi.mocked(addHashAsMagnet).mockResolvedValue(mockTorrentId);
		vi.mocked(handleSelectFilesInRd).mockResolvedValue(undefined);
		vi.mocked(getTorrentInfo).mockRejectedValue(error);
		vi.mocked(deleteTorrent).mockResolvedValue(undefined);

		await expect(getBiggestFileStreamUrl(mockRdKey, mockHash, mockIpAddress)).rejects.toThrow(
			'Failed to get torrent info'
		);
		expect(console.error).toHaveBeenCalledWith('error after adding hash', error);
		expect(deleteTorrent).toHaveBeenCalledWith(mockRdKey, mockTorrentId, false);
	});

	it('refuses to cast when RD returns fewer links than selected files', async () => {
		vi.mocked(addHashAsMagnet).mockResolvedValue(mockTorrentId);
		vi.mocked(handleSelectFilesInRd).mockResolvedValue(undefined);
		vi.mocked(getTorrentInfo).mockResolvedValue(
			createTorrentInfo({
				id: mockTorrentId,
				files: [
					{ id: 1, path: 'file-1.mkv', selected: 1, bytes: 2000000000 },
					{ id: 2, path: 'file-2.mkv', selected: 1, bytes: 1000000000 },
				],
				links: ['link1'], // Only one link, but biggest file is at index 0
			})
		);
		vi.mocked(deleteTorrent).mockResolvedValue(undefined);

		await expect(getBiggestFileStreamUrl(mockRdKey, mockHash, mockIpAddress)).rejects.toThrow(
			'link count mismatch'
		);
		expect(unrestrictLink).not.toHaveBeenCalled();
	});

	// Regression: `links` is selected-files-only, so indexing it with a position
	// taken from the full `files` array casts a different file. Measured against
	// the live RD library on 2026-08-24 - 3 of 55 multi-file torrents mis-indexed,
	// and every one of them fell through the old `?? links[0]` onto a wrong file.
	it('pairs the biggest file with its own link when non-video files are deselected', async () => {
		vi.mocked(addHashAsMagnet).mockResolvedValue(mockTorrentId);
		vi.mocked(handleSelectFilesInRd).mockResolvedValue(undefined);
		vi.mocked(getTorrentInfo).mockResolvedValue(
			createTorrentInfo({
				id: mockTorrentId,
				files: [
					{ id: 1, path: 'sample.mkv', selected: 1, bytes: 50000000 },
					{ id: 2, path: 'movie.nfo', selected: 0, bytes: 2000 },
					{ id: 3, path: 'subs.srt', selected: 0, bytes: 40000 },
					{ id: 4, path: 'movie.mkv', selected: 1, bytes: 8000000000 },
				],
				links: ['link-sample', 'link-movie'],
			})
		);
		vi.mocked(unrestrictLink).mockResolvedValue(
			createUnrestrictResponse({
				download: 'https://stream.example.com/movie.mkv',
				link: 'https://download.example.com/movie.mkv',
				filename: 'movie.mkv',
				filesize: 8000000000,
			})
		);
		vi.mocked(deleteTorrent).mockResolvedValue(undefined);

		await getBiggestFileStreamUrl(mockRdKey, mockHash, mockIpAddress);

		// The old code took findIndex over `files` (3), overran `links`, and fell
		// back to links[0] - casting the sample instead of the movie.
		expect(unrestrictLink).toHaveBeenCalledWith(mockRdKey, 'link-movie', mockIpAddress, false);
	});

	it('never picks a deselected file even when it is the biggest in the torrent', async () => {
		vi.mocked(addHashAsMagnet).mockResolvedValue(mockTorrentId);
		vi.mocked(handleSelectFilesInRd).mockResolvedValue(undefined);
		vi.mocked(getTorrentInfo).mockResolvedValue(
			createTorrentInfo({
				id: mockTorrentId,
				files: [
					{ id: 1, path: 'movie.mkv', selected: 1, bytes: 8000000000 },
					{ id: 2, path: 'extras.iso', selected: 0, bytes: 20000000000 },
				],
				links: ['link-movie'],
			})
		);
		vi.mocked(unrestrictLink).mockResolvedValue(
			createUnrestrictResponse({
				download: 'https://stream.example.com/movie.mkv',
				link: 'https://download.example.com/movie.mkv',
				filename: 'movie.mkv',
				filesize: 8000000000,
			})
		);
		vi.mocked(deleteTorrent).mockResolvedValue(undefined);

		await getBiggestFileStreamUrl(mockRdKey, mockHash, mockIpAddress);

		expect(unrestrictLink).toHaveBeenCalledWith(mockRdKey, 'link-movie', mockIpAddress, false);
	});
});
