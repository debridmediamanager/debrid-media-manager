import axios from 'axios';
import toast from 'react-hot-toast';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('axios');
vi.mock('react-hot-toast');
vi.mock('./allDebridCastClientPipeline', () => ({
	prepareMagnetForCast: vi.fn(),
	pickBiggestVideo: vi.fn(),
	findVideoByName: vi.fn(),
}));
vi.mock('./groupBy', () => ({
	groupBy: vi.fn((size: number, arr: any[]) => {
		const result: any[][] = [];
		for (let i = 0; i < arr.length; i += size) {
			result.push(arr.slice(i, i + size));
		}
		return result;
	}),
}));

import {
	deleteAllDebridCastedLink,
	fetchAllDebridCastedLinks,
	handleCastMovieAllDebrid,
	handleCastTvShowAllDebrid,
	saveAllDebridCastProfile,
	syncAllDebridCastSettings,
} from './allDebridCastApiClient';
import {
	findVideoByName,
	pickBiggestVideo,
	prepareMagnetForCast,
} from './allDebridCastClientPipeline';

describe('allDebridCastApiClient', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('handleCastMovieAllDebrid', () => {
		it('casts movie and shows success toast', async () => {
			vi.mocked(prepareMagnetForCast).mockResolvedValue({
				magnetId: 1,
				videoFiles: [{ path: 'Movie.mkv', size: 1000, link: 'http://link' }],
			});
			vi.mocked(pickBiggestVideo).mockReturnValue({
				fileIndex: 0,
				link: 'http://link',
				filename: 'Movie.mkv',
				fileSize: 1024,
			});
			vi.mocked(axios.post).mockResolvedValue({ data: {} });

			await handleCastMovieAllDebrid('tt123', 'key', 'hash');

			expect(axios.post).toHaveBeenCalledWith(
				'/api/stremio-ad/cast/movie/tt123',
				expect.objectContaining({
					apiKey: 'key',
					hash: 'hash',
					magnetId: 1,
					filename: 'Movie.mkv',
				})
			);
			expect(toast).toHaveBeenCalledWith(
				'Casted Movie.mkv to Stremio (AllDebrid).',
				expect.any(Object)
			);
		});

		it('shows error toast on failure', async () => {
			vi.mocked(prepareMagnetForCast).mockRejectedValue(new Error('Upload failed'));
			const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

			await handleCastMovieAllDebrid('tt123', 'key', 'hash');

			expect(toast.error).toHaveBeenCalledWith('Upload failed', expect.any(Object));
			consoleSpy.mockRestore();
		});

		it('uses error from response data when available', async () => {
			vi.mocked(prepareMagnetForCast).mockRejectedValue({
				response: { data: { errorMessage: 'Server-side error' } },
			});
			const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

			await handleCastMovieAllDebrid('tt123', 'key', 'hash');

			expect(toast.error).toHaveBeenCalledWith('Server-side error', expect.any(Object));
			consoleSpy.mockRestore();
		});
	});

	describe('handleCastTvShowAllDebrid', () => {
		it('casts TV show episodes and shows success toast', async () => {
			vi.mocked(prepareMagnetForCast).mockResolvedValue({
				magnetId: 1,
				videoFiles: [
					{ path: 'S01E01.mkv', size: 500, link: 'http://link1' },
					{ path: 'S01E02.mkv', size: 500, link: 'http://link2' },
				],
			});
			vi.mocked(findVideoByName).mockImplementation((_files, name) => ({
				fileIndex: 0,
				link: 'http://link',
				filename: name,
				fileSize: 500,
			}));
			vi.mocked(axios.post).mockResolvedValue({ data: { errorEpisodes: [] } });

			await handleCastTvShowAllDebrid('tt123', 'key', 'hash', [
				{ filename: 'S01E01.mkv' },
				{ filename: 'S01E02.mkv' },
			]);

			expect(axios.post).toHaveBeenCalled();
			expect(toast.success).toHaveBeenCalledWith(
				'Finished casting all episodes to Stremio (AllDebrid).',
				expect.any(Object)
			);
		});

		it('shows error when prep fails', async () => {
			vi.mocked(prepareMagnetForCast).mockRejectedValue(new Error('Prep fail'));

			await handleCastTvShowAllDebrid('tt123', 'key', 'hash', [{ filename: 'ep.mkv' }]);

			expect(toast.error).toHaveBeenCalledWith(
				'AllDebrid cast prep failed: Prep fail',
				expect.any(Object)
			);
		});

		it('shows error for missing files', async () => {
			vi.mocked(prepareMagnetForCast).mockResolvedValue({
				magnetId: 1,
				videoFiles: [],
			});
			vi.mocked(findVideoByName).mockReturnValue(null);

			await handleCastTvShowAllDebrid('tt123', 'key', 'hash', [
				{ filename: 'missing1.mkv' },
				{ filename: 'missing2.mkv' },
			]);

			expect(toast.error).toHaveBeenCalledWith(
				'2 episode files not found in magnet (AllDebrid).',
				expect.any(Object)
			);
		});

		it('returns early when all files are missing', async () => {
			vi.mocked(prepareMagnetForCast).mockResolvedValue({
				magnetId: 1,
				videoFiles: [],
			});
			vi.mocked(findVideoByName).mockReturnValue(null);

			await handleCastTvShowAllDebrid('tt123', 'key', 'hash', [{ filename: 'x.mkv' }]);

			expect(axios.post).not.toHaveBeenCalled();
		});

		it('handles error episodes from server', async () => {
			vi.mocked(prepareMagnetForCast).mockResolvedValue({
				magnetId: 1,
				videoFiles: [{ path: 'ep.mkv', size: 100, link: 'http://link' }],
			});
			vi.mocked(findVideoByName).mockReturnValue({
				fileIndex: 0,
				link: 'http://link',
				filename: 'ep.mkv',
				fileSize: 100,
			});
			vi.mocked(axios.post).mockResolvedValue({
				data: { errorEpisodes: ['S01E01', 'S01E02'] },
			});

			await handleCastTvShowAllDebrid('tt123', 'key', 'hash', [{ filename: 'ep.mkv' }]);

			expect(toast.error).toHaveBeenCalledWith(
				expect.stringContaining('S01E01'),
				expect.any(Object)
			);
		});
	});

	describe('saveAllDebridCastProfile', () => {
		it('posts profile data and returns the cast token', async () => {
			vi.mocked(axios.post).mockResolvedValue({ data: { profile: { userId: 'cast-1' } } });

			const token = await saveAllDebridCastProfile('key', {
				movieMaxSize: 5000,
				episodeMaxSize: 2000,
				otherStreamsLimit: 10,
				hideCastOption: false,
			});

			expect(axios.post).toHaveBeenCalledWith(
				'/api/stremio-ad/cast/saveProfile',
				{
					apiKey: 'key',
					movieMaxSize: 5000,
					episodeMaxSize: 2000,
					otherStreamsLimit: 10,
					hideCastOption: false,
				},
				{ headers: {} }
			);
			expect(token).toBe('cast-1');
		});

		it('omits undefined optional fields', async () => {
			vi.mocked(axios.post).mockResolvedValue({ data: {} });

			await saveAllDebridCastProfile('key');

			expect(axios.post).toHaveBeenCalledWith(
				'/api/stremio-ad/cast/saveProfile',
				{
					apiKey: 'key',
				},
				{ headers: {} }
			);
		});

		it('silently handles errors', async () => {
			vi.mocked(axios.post).mockRejectedValue(new Error('fail'));
			const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

			await expect(saveAllDebridCastProfile('key')).resolves.toBeNull();

			consoleSpy.mockRestore();
		});
	});

	describe('syncAllDebridCastSettings', () => {
		it('uses the cast token and never sends the api key', async () => {
			vi.mocked(axios.post).mockResolvedValue({ data: {} });

			const token = await syncAllDebridCastSettings('cast-1', 'key', {
				movieMaxSize: 3000,
				episodeMaxSize: 1000,
				otherStreamsLimit: 5,
				hideCastOption: true,
			});

			expect(axios.post).toHaveBeenCalledTimes(1);
			expect(axios.post).toHaveBeenCalledWith(
				'/api/stremio-ad/cast/updateSizeLimits',
				{
					castToken: 'cast-1',
					movieMaxSize: 3000,
					episodeMaxSize: 1000,
					otherStreamsLimit: 5,
					hideCastOption: true,
				},
				{ headers: {} }
			);
			expect(token).toBe('cast-1');
		});

		it('falls back to the api key when the profile is gone', async () => {
			vi.mocked(axios.post)
				.mockRejectedValueOnce({ response: { status: 404 } })
				.mockResolvedValueOnce({ data: { profile: { userId: 'cast-2' } } });

			const token = await syncAllDebridCastSettings('stale', 'key', { hideCastOption: true });

			expect(axios.post).toHaveBeenNthCalledWith(
				2,
				'/api/stremio-ad/cast/saveProfile',
				{
					apiKey: 'key',
					hideCastOption: true,
				},
				{ headers: {} }
			);
			expect(token).toBe('cast-2');
		});

		it('enrols with the api key when there is no token yet', async () => {
			vi.mocked(axios.post).mockResolvedValue({ data: { profile: { userId: 'cast-3' } } });

			const token = await syncAllDebridCastSettings(null, 'key', {});

			expect(axios.post).toHaveBeenCalledTimes(1);
			expect(axios.post).toHaveBeenCalledWith(
				'/api/stremio-ad/cast/saveProfile',
				{
					apiKey: 'key',
				},
				{ headers: {} }
			);
			expect(token).toBe('cast-3');
		});

		it('surfaces a toast on non-404 errors instead of falling back', async () => {
			vi.mocked(axios.post).mockRejectedValue({ response: { status: 500 } });
			const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

			await expect(syncAllDebridCastSettings('cast-1', 'key', {})).resolves.toBeNull();
			expect(axios.post).toHaveBeenCalledTimes(1);
			expect(toast.error).toHaveBeenCalledWith(
				'Failed to save AllDebrid cast settings. Please try again.'
			);

			consoleSpy.mockRestore();
		});
	});

	describe('fetchAllDebridCastedLinks', () => {
		it('returns links array without putting the key in the url', async () => {
			vi.mocked(axios.post).mockResolvedValue({
				data: { links: [{ id: 1 }, { id: 2 }] },
			});

			const result = await fetchAllDebridCastedLinks('key');

			expect(axios.post).toHaveBeenCalledWith('/api/stremio-ad/links', { apiKey: 'key' });
			expect(result).toEqual([{ id: 1 }, { id: 2 }]);
		});

		it('returns empty array on error', async () => {
			vi.mocked(axios.post).mockRejectedValue(new Error('fail'));
			const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

			const result = await fetchAllDebridCastedLinks('key');

			expect(result).toEqual([]);
			consoleSpy.mockRestore();
		});

		it('returns empty array when links is missing', async () => {
			vi.mocked(axios.post).mockResolvedValue({ data: {} });

			const result = await fetchAllDebridCastedLinks('key');

			expect(result).toEqual([]);
		});
	});

	describe('deleteAllDebridCastedLink', () => {
		it('returns true on success', async () => {
			vi.mocked(axios.delete).mockResolvedValue({ data: {} });

			const result = await deleteAllDebridCastedLink('key', 'tt123', 'hash');

			expect(axios.delete).toHaveBeenCalledWith('/api/stremio-ad/deletelink', {
				data: { apiKey: 'key', imdbId: 'tt123', hash: 'hash' },
			});
			expect(result).toBe(true);
		});

		it('returns false on error', async () => {
			vi.mocked(axios.delete).mockRejectedValue(new Error('fail'));
			const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

			const result = await deleteAllDebridCastedLink('key', 'tt123', 'hash');

			expect(result).toBe(false);
			consoleSpy.mockRestore();
		});
	});
});
