import axios from 'axios';
import toast from 'react-hot-toast';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleCastMovie, handleCastTvShow, saveCastProfile } from './castApiClient';

vi.mock('axios');
vi.mock('react-hot-toast');

describe('castApiClient', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('handleCastMovie', () => {
		it('successfully casts a movie and shows success toast', async () => {
			const mockResponse = {
				data: { filename: 'Test Movie.mp4' },
			};
			vi.mocked(axios.get).mockResolvedValue(mockResponse);

			await handleCastMovie('tt1234567', 'test-rd-key', 'test-hash');

			expect(axios.get).toHaveBeenCalledWith(
				'/api/stremio/cast/movie/tt1234567?hash=test-hash',
				// The key rides in the header - a query parameter is written verbatim
				// into every access log on the way.
				{ headers: { Authorization: 'Bearer test-rd-key' } }
			);
			expect(toast).toHaveBeenCalledWith(
				'Casted Test Movie.mp4 to Stremio.',
				expect.any(Object)
			);
		});

		it('handles errors and shows error toast', async () => {
			vi.mocked(axios.get).mockRejectedValue(new Error('Network error'));

			await handleCastMovie('tt1234567', 'test-rd-key', 'test-hash');

			expect(toast.error).toHaveBeenCalledWith('Network error', expect.any(Object));
		});

		it('logs error message when error is an Error instance', async () => {
			const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
			const error = new Error('Network error');
			vi.mocked(axios.get).mockRejectedValue(error);

			await handleCastMovie('tt1234567', 'test-rd-key', 'test-hash');

			expect(consoleErrorSpy).toHaveBeenCalledWith('Error casting movie:', 'Network error');
			consoleErrorSpy.mockRestore();
		});

		it('logs unknown error when error is not an Error instance', async () => {
			const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
			vi.mocked(axios.get).mockRejectedValue('string error');

			await handleCastMovie('tt1234567', 'test-rd-key', 'test-hash');

			expect(consoleErrorSpy).toHaveBeenCalledWith('Error casting movie:', 'Unknown error');
			consoleErrorSpy.mockRestore();
		});
	});

	describe('handleCastTvShow', () => {
		it('successfully casts TV show episodes in batches', async () => {
			const mockResponse = {
				data: { errorEpisodes: [] },
			};
			vi.mocked(axios.get).mockResolvedValue(mockResponse);

			await handleCastTvShow('tt1234567', 'test-rd-key', 'test-hash', ['1', '2', '3']);

			expect(axios.get).toHaveBeenCalled();
			expect(toast.success).toHaveBeenCalledWith(
				expect.stringContaining('episode'),
				expect.any(Object)
			);
		});

		it('handles error episodes and shows error toast', async () => {
			const mockResponse = {
				data: { errorEpisodes: ['S01E01'] },
			};
			vi.mocked(axios.get).mockResolvedValue(mockResponse);

			await handleCastTvShow('tt1234567', 'test-rd-key', 'test-hash', ['1', '2']);

			expect(toast.error).toHaveBeenCalledWith(
				expect.stringContaining('Cast failed for S01E01'),
				expect.any(Object)
			);
		});

		it('shows multiple error episodes count', async () => {
			const mockResponse = {
				data: { errorEpisodes: ['S01E01', 'S01E02', 'S01E03'] },
			};
			vi.mocked(axios.get).mockResolvedValue(mockResponse);

			await handleCastTvShow('tt1234567', 'test-rd-key', 'test-hash', ['1', '2', '3']);

			expect(toast.error).toHaveBeenCalledWith(
				expect.stringContaining('and 2 more'),
				expect.any(Object)
			);
		});

		it('shows singular episode text for single episode', async () => {
			const mockResponse = {
				data: { errorEpisodes: [] },
			};
			vi.mocked(axios.get).mockResolvedValue(mockResponse);

			await handleCastTvShow('tt1234567', 'test-rd-key', 'test-hash', ['1']);

			expect(toast.success).toHaveBeenCalledWith(
				'Casted 1 episode to Stremio.',
				expect.any(Object)
			);
		});

		it('shows plural episodes text for multiple episodes', async () => {
			const mockResponse = {
				data: { errorEpisodes: [] },
			};
			vi.mocked(axios.get).mockResolvedValue(mockResponse);

			await handleCastTvShow('tt1234567', 'test-rd-key', 'test-hash', ['1', '2', '3']);

			expect(toast.success).toHaveBeenCalledWith(
				expect.stringContaining('episodes'),
				expect.any(Object)
			);
		});

		it('handles network errors during batch casting', async () => {
			vi.mocked(axios.get).mockRejectedValue(new Error('Network error'));

			await handleCastTvShow('tt1234567', 'test-rd-key', 'test-hash', ['1', '2']);

			expect(toast.error).toHaveBeenCalledWith(
				expect.stringContaining('Failed to cast'),
				expect.any(Object)
			);
		});

		it('batches file IDs correctly into groups of 5', async () => {
			const mockResponse = {
				data: { errorEpisodes: [] },
			};
			vi.mocked(axios.get).mockResolvedValue(mockResponse);

			const fileIds = ['1', '2', '3', '4', '5', '6', '7', '8'];
			await handleCastTvShow('tt1234567', 'test-rd-key', 'test-hash', fileIds);

			// Should make 2 calls: one for first 5, one for remaining 3
			expect(axios.get).toHaveBeenCalledTimes(2);
		});

		it('shows final success message after all batches complete', async () => {
			const mockResponse = {
				data: { errorEpisodes: [] },
			};
			vi.mocked(axios.get).mockResolvedValue(mockResponse);

			await handleCastTvShow('tt1234567', 'test-rd-key', 'test-hash', ['1', '2']);

			expect(toast.success).toHaveBeenCalledWith(
				'Finished casting all episodes to Stremio.',
				expect.any(Object)
			);
		});
	});

	describe('saveCastProfile', () => {
		it('successfully saves cast profile', async () => {
			vi.mocked(axios.post).mockResolvedValue({ data: {} });

			await saveCastProfile('client-id', 'client-secret', 'refresh-token');

			expect(axios.post).toHaveBeenCalledWith('/api/stremio/cast/saveProfile', {
				clientId: 'client-id',
				clientSecret: 'client-secret',
				refreshToken: 'refresh-token',
			});
		});

		it('silently handles errors without throwing', async () => {
			vi.mocked(axios.post).mockRejectedValue(new Error('Network error'));

			// Should not throw
			await expect(
				saveCastProfile('client-id', 'client-secret', 'refresh-token')
			).resolves.not.toThrow();
		});

		it('catches and suppresses any error type', async () => {
			vi.mocked(axios.post).mockRejectedValue('string error');

			await expect(
				saveCastProfile('client-id', 'client-secret', 'refresh-token')
			).resolves.not.toThrow();
		});
	});
});
