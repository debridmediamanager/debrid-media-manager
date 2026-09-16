import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useExternalSources } from './useExternalSources';

const axiosMocks = vi.hoisted(() => ({
	get: vi.fn(),
	post: vi.fn(),
}));

vi.mock('axios', () => ({
	default: {
		get: axiosMocks.get,
		post: axiosMocks.post,
	},
}));

vi.mock('@/utils/token', () => ({
	generateTokenAndHash: vi.fn(async () => ['token-abc', 'hash-abc']),
}));

const { get: mockGet, post: mockPost } = axiosMocks;

describe('useExternalSources', () => {
	beforeEach(() => {
		localStorage.clear();
		mockGet.mockReset();
		mockPost.mockReset();
	});

	it('reuses cached mediafusion hash and requests mediafusion catalog', async () => {
		localStorage.setItem('mediafusion_hash', JSON.stringify({ hash: 'legacy-hash' }));
		mockGet.mockResolvedValue({ data: { streams: [] } });
		const { result } = renderHook(() => useExternalSources('rd-key'));

		await act(async () => {
			await result.current.fetchMovieFromExternalSource('tt123', 'mediafusion');
		});

		expect(mockGet).toHaveBeenCalledTimes(1);
		expect(mockGet.mock.calls[0][0]).toContain('legacy-hash');
	});

	it('transforms torrentio streams into search results', async () => {
		localStorage.setItem('mediafusion_hash', 'hash');
		mockGet.mockResolvedValue({
			data: {
				streams: [
					{
						title: 'Movie Title\n💾 1.5 GB',
						url: '/ABCDEF1234567890ABCDEF1234567890ABCDEF12/stream',
						behaviorHints: {
							filename: 'Movie Title.mkv',
							videoSize: 1024 * 1024 * 1500,
						},
					},
				],
			},
		});
		const { result } = renderHook(() => useExternalSources('rd-key'));

		let outputs: any[] = [];
		await act(async () => {
			outputs = await result.current.fetchMovieFromExternalSource('tt999', 'torrentio');
		});

		expect(outputs).toHaveLength(1);
		expect(outputs[0]).toMatchObject({
			title: 'Movie Title',
			imdbId: 'tt999',
		});
	});

	it('uses proxy endpoint for tor sources when fetching episodes', async () => {
		mockGet.mockResolvedValue({ data: { streams: [] } });
		const { result } = renderHook(() => useExternalSources('rd-key'));

		await act(async () => {
			await result.current.fetchEpisodeFromExternalSource('tt555', 1, 2, 'torrentio-tor');
		});

		expect(mockGet.mock.calls[0][0]).toBe('/api/proxy/stream');
		expect(mockGet.mock.calls[0][1]?.params?.service).toBe('torrentio-tor');
		// The proxy only answers callers carrying a server-signed token.
		expect(mockGet.mock.calls[0][1]?.params?.dmmProblemKey).toBe('token-abc');
		expect(mockGet.mock.calls[0][1]?.params?.solution).toBe('hash-abc');
	});

	it('reads enabled sources from localStorage flags', () => {
		localStorage.setItem('settings:enableComet', 'false');
		localStorage.setItem('settings:enableOcean', 'false'); // ignored unknown key
		const { result } = renderHook(() => useExternalSources('rd-key'));

		const sources = result.current.getEnabledSources();
		expect(sources).toContain('torrentio');
		expect(sources).not.toContain('comet');
	});
});
