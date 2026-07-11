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
	deleteTorrinCastedLink,
	fetchTorrinCastedLinks,
	handleCastMovieTorrin,
	handleCastTvShowTorrin,
	saveTorrinCastProfile,
	updateTorrinSizeLimits,
} from './torrinCastApiClient';

const BASE = 'https://tr.test';
const KEY = 'key';
const creds = `baseUrl=${encodeURIComponent(BASE)}&apiKey=${encodeURIComponent(KEY)}`;

describe('torrinCastApiClient', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('handleCastMovieTorrin', () => {
		it('casts a movie and shows a success toast', async () => {
			vi.mocked(axios.get).mockResolvedValue({ data: { filename: 'Movie.mkv' } });

			await handleCastMovieTorrin('tt123', BASE, KEY, 'hash');

			expect(axios.get).toHaveBeenCalledWith(
				`/api/stremio-tr/cast/movie/tt123?${creds}&hash=hash`
			);
			expect(toast).toHaveBeenCalledWith(
				'Casted Movie.mkv to Stremio (Torrin).',
				expect.any(Object)
			);
		});

		it('surfaces the server error message', async () => {
			vi.mocked(axios.get).mockRejectedValue({
				response: { data: { errorMessage: 'Server error' } },
			});
			const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

			await handleCastMovieTorrin('tt123', BASE, KEY, 'hash');

			expect(toast.error).toHaveBeenCalledWith('Server error', expect.any(Object));
			consoleSpy.mockRestore();
		});
	});

	describe('handleCastTvShowTorrin', () => {
		it('casts episodes and shows a success toast', async () => {
			vi.mocked(axios.get).mockResolvedValue({ data: { errorEpisodes: [] } });

			await handleCastTvShowTorrin('tt123', BASE, KEY, 'hash', ['1', '2']);

			expect(toast.success).toHaveBeenCalledWith(
				'Finished casting all episodes to Stremio (Torrin).',
				expect.any(Object)
			);
		});

		it('builds the URL with fileIds params', async () => {
			vi.mocked(axios.get).mockResolvedValue({ data: { errorEpisodes: [] } });

			await handleCastTvShowTorrin('tt123', BASE, KEY, 'hash', ['10', '20']);

			expect(axios.get).toHaveBeenCalledWith(
				`/api/stremio-tr/cast/series/tt123?${creds}&hash=hash&fileIds=10&fileIds=20`
			);
		});

		it('reports failed episodes', async () => {
			vi.mocked(axios.get).mockResolvedValue({ data: { errorEpisodes: ['S01E01'] } });

			await handleCastTvShowTorrin('tt123', BASE, KEY, 'hash', ['1']);

			expect(toast.error).toHaveBeenCalledWith(
				expect.stringContaining('Cast failed for S01E01'),
				expect.any(Object)
			);
		});
	});

	describe('saveTorrinCastProfile', () => {
		it('posts profile data with baseUrl + apiKey', async () => {
			vi.mocked(axios.post).mockResolvedValue({ data: {} });

			await saveTorrinCastProfile(BASE, KEY, 5000, 2000, 3, false);

			expect(axios.post).toHaveBeenCalledWith('/api/stremio-tr/cast/saveProfile', {
				baseUrl: BASE,
				apiKey: KEY,
				movieMaxSize: 5000,
				episodeMaxSize: 2000,
				otherStreamsLimit: 3,
				hideCastOption: false,
			});
		});

		it('omits undefined optional fields', async () => {
			vi.mocked(axios.post).mockResolvedValue({ data: {} });

			await saveTorrinCastProfile(BASE, KEY);

			expect(axios.post).toHaveBeenCalledWith('/api/stremio-tr/cast/saveProfile', {
				baseUrl: BASE,
				apiKey: KEY,
			});
		});

		it('silently handles errors', async () => {
			vi.mocked(axios.post).mockRejectedValue(new Error('fail'));
			const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

			await expect(saveTorrinCastProfile(BASE, KEY)).resolves.not.toThrow();

			consoleSpy.mockRestore();
		});
	});

	describe('updateTorrinSizeLimits', () => {
		it('posts size-limit data', async () => {
			vi.mocked(axios.post).mockResolvedValue({ data: {} });

			await updateTorrinSizeLimits(BASE, KEY, 3000, 1000, 5, true);

			expect(axios.post).toHaveBeenCalledWith('/api/stremio-tr/cast/updateSizeLimits', {
				baseUrl: BASE,
				apiKey: KEY,
				movieMaxSize: 3000,
				episodeMaxSize: 1000,
				otherStreamsLimit: 5,
				hideCastOption: true,
			});
		});
	});

	describe('fetchTorrinCastedLinks', () => {
		it('returns the links array', async () => {
			vi.mocked(axios.get).mockResolvedValue({ data: { links: [{ id: 1 }] } });

			const result = await fetchTorrinCastedLinks(BASE, KEY);

			expect(axios.get).toHaveBeenCalledWith(`/api/stremio-tr/links?${creds}`);
			expect(result).toEqual([{ id: 1 }]);
		});

		it('returns an empty array on error', async () => {
			vi.mocked(axios.get).mockRejectedValue(new Error('fail'));
			const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

			const result = await fetchTorrinCastedLinks(BASE, KEY);

			expect(result).toEqual([]);
			consoleSpy.mockRestore();
		});
	});

	describe('deleteTorrinCastedLink', () => {
		it('returns true on success', async () => {
			vi.mocked(axios.delete).mockResolvedValue({ data: {} });

			const result = await deleteTorrinCastedLink(BASE, KEY, 'tt123', 'hash');

			expect(axios.delete).toHaveBeenCalledWith('/api/stremio-tr/deletelink', {
				data: { baseUrl: BASE, apiKey: KEY, imdbId: 'tt123', hash: 'hash' },
			});
			expect(result).toBe(true);
		});

		it('returns false on error', async () => {
			vi.mocked(axios.delete).mockRejectedValue(new Error('fail'));
			const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

			const result = await deleteTorrinCastedLink(BASE, KEY, 'tt123', 'hash');

			expect(result).toBe(false);
			consoleSpy.mockRestore();
		});
	});
});
