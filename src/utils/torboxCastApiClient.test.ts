import axios from 'axios';
import toast from 'react-hot-toast';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('axios');
vi.mock('react-hot-toast');
vi.mock('./batch', () => ({
	runConcurrentFunctions: vi.fn(async (fns: (() => Promise<any>)[]) => {
		const results = [];
		for (const fn of fns) {
			results.push(await fn());
		}
		return [results];
	}),
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
	deleteTorBoxCastedLink,
	fetchTorBoxCastedLinks,
	handleCastMovieTorBox,
	handleCastTvShowTorBox,
	saveTorBoxCastProfile,
	updateTorBoxSizeLimits,
} from './torboxCastApiClient';

describe('torboxCastApiClient', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('handleCastMovieTorBox', () => {
		it('casts movie and shows success toast', async () => {
			vi.mocked(axios.get).mockResolvedValue({
				data: { filename: 'Movie.mkv' },
			});

			await handleCastMovieTorBox('tt123', 'key', 'hash');

			expect(axios.get).toHaveBeenCalledWith(
				'/api/stremio-tb/cast/movie/tt123?apiKey=key&hash=hash'
			);
			expect(toast).toHaveBeenCalledWith(
				'Casted Movie.mkv to Stremio (TorBox).',
				expect.any(Object)
			);
		});

		it('shows error toast on failure', async () => {
			vi.mocked(axios.get).mockRejectedValue(new Error('Network error'));
			const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

			await handleCastMovieTorBox('tt123', 'key', 'hash');

			expect(toast.error).toHaveBeenCalledWith('Network error', expect.any(Object));
			consoleSpy.mockRestore();
		});

		it('uses error from response data when available', async () => {
			vi.mocked(axios.get).mockRejectedValue({
				response: { data: { errorMessage: 'Server error' } },
			});
			const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

			await handleCastMovieTorBox('tt123', 'key', 'hash');

			expect(toast.error).toHaveBeenCalledWith('Server error', expect.any(Object));
			consoleSpy.mockRestore();
		});

		it('shows Unknown error for non-Error throws', async () => {
			vi.mocked(axios.get).mockRejectedValue('string error');
			const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

			await handleCastMovieTorBox('tt123', 'key', 'hash');

			expect(toast.error).toHaveBeenCalledWith('Unknown error', expect.any(Object));
			consoleSpy.mockRestore();
		});
	});

	describe('handleCastTvShowTorBox', () => {
		it('casts episodes and shows success toast', async () => {
			vi.mocked(axios.get).mockResolvedValue({
				data: { errorEpisodes: [] },
			});

			await handleCastTvShowTorBox('tt123', 'key', 'hash', ['1', '2']);

			expect(axios.get).toHaveBeenCalled();
			expect(toast.success).toHaveBeenCalledWith(
				'Finished casting all episodes to Stremio (TorBox).',
				expect.any(Object)
			);
		});

		it('shows error for failed episodes', async () => {
			vi.mocked(axios.get).mockResolvedValue({
				data: { errorEpisodes: ['S01E01'] },
			});

			await handleCastTvShowTorBox('tt123', 'key', 'hash', ['1']);

			expect(toast.error).toHaveBeenCalledWith(
				expect.stringContaining('Cast failed for S01E01'),
				expect.any(Object)
			);
		});

		it('shows count for multiple error episodes', async () => {
			vi.mocked(axios.get).mockResolvedValue({
				data: { errorEpisodes: ['S01E01', 'S01E02', 'S01E03'] },
			});

			await handleCastTvShowTorBox('tt123', 'key', 'hash', ['1', '2', '3']);

			expect(toast.error).toHaveBeenCalledWith(
				expect.stringContaining('and 2 more'),
				expect.any(Object)
			);
		});

		it('shows singular episode text for single episode batch', async () => {
			vi.mocked(axios.get).mockResolvedValue({
				data: { errorEpisodes: [] },
			});

			await handleCastTvShowTorBox('tt123', 'key', 'hash', ['1']);

			expect(toast.success).toHaveBeenCalledWith(
				'Casted 1 episode to Stremio (TorBox).',
				expect.any(Object)
			);
		});

		it('handles network errors during batch', async () => {
			vi.mocked(axios.get).mockRejectedValue(new Error('Network error'));

			await handleCastTvShowTorBox('tt123', 'key', 'hash', ['1']);

			expect(toast.error).toHaveBeenCalledWith(
				expect.stringContaining('Failed to cast'),
				expect.any(Object)
			);
		});

		it('builds correct URL with fileIds params', async () => {
			vi.mocked(axios.get).mockResolvedValue({
				data: { errorEpisodes: [] },
			});

			await handleCastTvShowTorBox('tt123', 'key', 'hash', ['10', '20']);

			expect(axios.get).toHaveBeenCalledWith(
				'/api/stremio-tb/cast/series/tt123?apiKey=key&hash=hash&fileIds=10&fileIds=20'
			);
		});
	});

	describe('saveTorBoxCastProfile', () => {
		it('posts profile data', async () => {
			vi.mocked(axios.post).mockResolvedValue({ data: {} });

			await saveTorBoxCastProfile('key', 5000, 2000, 10, false);

			expect(axios.post).toHaveBeenCalledWith('/api/stremio-tb/cast/saveProfile', {
				apiKey: 'key',
				movieMaxSize: 5000,
				episodeMaxSize: 2000,
				otherStreamsLimit: 10,
				hideCastOption: false,
			});
		});

		it('omits undefined optional fields', async () => {
			vi.mocked(axios.post).mockResolvedValue({ data: {} });

			await saveTorBoxCastProfile('key');

			expect(axios.post).toHaveBeenCalledWith('/api/stremio-tb/cast/saveProfile', {
				apiKey: 'key',
			});
		});

		it('silently handles errors', async () => {
			vi.mocked(axios.post).mockRejectedValue(new Error('fail'));
			const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

			await expect(saveTorBoxCastProfile('key')).resolves.not.toThrow();

			consoleSpy.mockRestore();
		});
	});

	describe('updateTorBoxSizeLimits', () => {
		it('posts size limit data', async () => {
			vi.mocked(axios.post).mockResolvedValue({ data: {} });

			await updateTorBoxSizeLimits('key', 3000, 1000, 5, true);

			expect(axios.post).toHaveBeenCalledWith('/api/stremio-tb/cast/updateSizeLimits', {
				apiKey: 'key',
				movieMaxSize: 3000,
				episodeMaxSize: 1000,
				otherStreamsLimit: 5,
				hideCastOption: true,
			});
		});

		it('silently handles errors', async () => {
			vi.mocked(axios.post).mockRejectedValue(new Error('fail'));
			const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

			await expect(updateTorBoxSizeLimits('key')).resolves.not.toThrow();

			consoleSpy.mockRestore();
		});
	});

	describe('fetchTorBoxCastedLinks', () => {
		it('returns links array', async () => {
			vi.mocked(axios.get).mockResolvedValue({
				data: { links: [{ id: 1 }] },
			});

			const result = await fetchTorBoxCastedLinks('key');

			expect(axios.get).toHaveBeenCalledWith('/api/stremio-tb/links?apiKey=key');
			expect(result).toEqual([{ id: 1 }]);
		});

		it('returns empty array on error', async () => {
			vi.mocked(axios.get).mockRejectedValue(new Error('fail'));
			const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

			const result = await fetchTorBoxCastedLinks('key');

			expect(result).toEqual([]);
			consoleSpy.mockRestore();
		});

		it('returns empty array when links is missing', async () => {
			vi.mocked(axios.get).mockResolvedValue({ data: {} });

			const result = await fetchTorBoxCastedLinks('key');

			expect(result).toEqual([]);
		});
	});

	describe('deleteTorBoxCastedLink', () => {
		it('returns true on success', async () => {
			vi.mocked(axios.delete).mockResolvedValue({ data: {} });

			const result = await deleteTorBoxCastedLink('key', 'tt123', 'hash');

			expect(axios.delete).toHaveBeenCalledWith('/api/stremio-tb/deletelink', {
				data: { apiKey: 'key', imdbId: 'tt123', hash: 'hash' },
			});
			expect(result).toBe(true);
		});

		it('returns false on error', async () => {
			vi.mocked(axios.delete).mockRejectedValue(new Error('fail'));
			const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

			const result = await deleteTorBoxCastedLink('key', 'tt123', 'hash');

			expect(result).toBe(false);
			consoleSpy.mockRestore();
		});
	});
});
