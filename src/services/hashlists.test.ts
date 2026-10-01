import axios from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { publishHashlist } from './hashlists';

// Mock axios
vi.mock('axios');

describe('hashlists service', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(console.error).mockImplementation(() => {});
	});

	describe('publishHashlist', () => {
		it('should create short URL successfully', async () => {
			const originalUrl = 'https://example.com/very-long-url-path';
			const expectedShortUrl = 'https://short.io/abc123';

			const mockResponse = {
				data: { shortUrl: expectedShortUrl },
			};

			vi.mocked(axios.post).mockResolvedValue(mockResponse);

			const result = await publishHashlist(originalUrl);

			expect(axios.post).toHaveBeenCalledWith('api/hashlists', { data: originalUrl });
			expect(result).toBe(expectedShortUrl);
		});

		it('should handle empty URL', async () => {
			const originalUrl = '';
			const expectedShortUrl = 'https://short.io/empty';

			const mockResponse = {
				data: { shortUrl: expectedShortUrl },
			};

			vi.mocked(axios.post).mockResolvedValue(mockResponse);

			const result = await publishHashlist(originalUrl);

			expect(axios.post).toHaveBeenCalledWith('api/hashlists', { data: '' });
			expect(result).toBe(expectedShortUrl);
		});

		it('should handle special characters in URL', async () => {
			const originalUrl =
				'https://example.com/path with spaces/special-chars-ñáéíóú.mp4?param=value&other=123';
			const expectedShortUrl = 'https://short.io/special';

			const mockResponse = {
				data: { shortUrl: expectedShortUrl },
			};

			vi.mocked(axios.post).mockResolvedValue(mockResponse);

			const result = await publishHashlist(originalUrl);

			expect(axios.post).toHaveBeenCalledWith('api/hashlists', { data: originalUrl });
			expect(result).toBe(expectedShortUrl);
		});

		it('should handle very long URLs', async () => {
			const longPath = 'a'.repeat(2000);
			const originalUrl = `https://example.com/${longPath}`;
			const expectedShortUrl = 'https://short.io/long';

			const mockResponse = {
				data: { shortUrl: expectedShortUrl },
			};

			vi.mocked(axios.post).mockResolvedValue(mockResponse);

			const result = await publishHashlist(originalUrl);

			expect(axios.post).toHaveBeenCalledWith('api/hashlists', { data: originalUrl });
			expect(result).toBe(expectedShortUrl);
		});

		it('should handle network errors', async () => {
			const originalUrl = 'https://example.com/test';
			const networkError = new Error('Network Error');

			vi.mocked(axios.post).mockRejectedValue(networkError);

			await expect(publishHashlist(originalUrl)).rejects.toThrow('Network Error');
			expect(console.error).toHaveBeenCalledWith('Error creating short URL:', networkError);
		});

		it('should handle API error responses', async () => {
			const originalUrl = 'https://example.com/test';
			const apiError = {
				response: {
					status: 400,
					data: { message: 'Invalid URL format' },
				},
			};

			vi.mocked(axios.post).mockRejectedValue(apiError);

			await expect(publishHashlist(originalUrl)).rejects.toEqual(apiError);
			expect(console.error).toHaveBeenCalledWith('Error creating short URL:', apiError);
		});

		it('should handle timeout errors', async () => {
			const originalUrl = 'https://example.com/slow';
			const timeoutError = new Error('Request timeout');

			vi.mocked(axios.post).mockRejectedValue(timeoutError);

			await expect(publishHashlist(originalUrl)).rejects.toThrow('Request timeout');
			expect(console.error).toHaveBeenCalledWith('Error creating short URL:', timeoutError);
		});

		it('should handle rate limiting errors', async () => {
			const originalUrl = 'https://example.com/rate-limited';
			const rateLimitError = {
				response: {
					status: 429,
					data: { message: 'Too many requests' },
				},
			};

			vi.mocked(axios.post).mockRejectedValue(rateLimitError);

			await expect(publishHashlist(originalUrl)).rejects.toEqual(rateLimitError);
			expect(console.error).toHaveBeenCalledWith('Error creating short URL:', rateLimitError);
		});

		it('should handle server errors', async () => {
			const originalUrl = 'https://example.com/server-error';
			const serverError = {
				response: {
					status: 500,
					data: { message: 'Internal server error' },
				},
			};

			vi.mocked(axios.post).mockRejectedValue(serverError);

			await expect(publishHashlist(originalUrl)).rejects.toEqual(serverError);
			expect(console.error).toHaveBeenCalledWith('Error creating short URL:', serverError);
		});

		it('should handle malformed response data', async () => {
			const originalUrl = 'https://example.com/malformed';

			const mockResponse = {
				data: { wrongField: 'not shortUrl' },
			};

			vi.mocked(axios.post).mockResolvedValue(mockResponse);

			// This should now throw an error for missing shortUrl
			await expect(publishHashlist(originalUrl)).rejects.toThrow(
				'Invalid response: missing shortUrl'
			);
			expect(axios.post).toHaveBeenCalledWith('api/hashlists', { data: originalUrl });
		});

		it('should handle empty response data', async () => {
			const originalUrl = 'https://example.com/empty-response';

			const mockResponse = {
				data: {},
			};

			vi.mocked(axios.post).mockResolvedValue(mockResponse);

			await expect(publishHashlist(originalUrl)).rejects.toThrow(
				'Invalid response: missing shortUrl'
			);
			expect(axios.post).toHaveBeenCalledWith('api/hashlists', { data: originalUrl });
		});

		it('should handle null response data', async () => {
			const originalUrl = 'https://example.com/null-response';

			const mockResponse = {
				data: null,
			};

			vi.mocked(axios.post).mockResolvedValue(mockResponse);

			await expect(publishHashlist(originalUrl)).rejects.toThrow(
				'Invalid response: missing shortUrl'
			);
			expect(axios.post).toHaveBeenCalledWith('api/hashlists', { data: originalUrl });
		});
	});
});
