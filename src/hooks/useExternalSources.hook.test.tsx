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
		localStorage.setItem('settings:enablePeerflix', 'false');
		localStorage.setItem('settings:enableOcean', 'false'); // ignored unknown key
		const { result } = renderHook(() => useExternalSources('rd-key'));

		const sources = result.current.getEnabledSources();
		expect(sources).toContain('torrentio');
		expect(sources).not.toContain('peerflix');
	});

	// An addon given the user's key can use it from its own servers, a second IP
	// on their Real-Debrid account: Comet and TorrentsDB were sent it by default.
	it("never sends the user's Real-Debrid key to any source, with every one switched on", async () => {
		localStorage.setItem('mediafusion_hash', 'hash');
		for (const key of [
			'settings:enableComet',
			'settings:enableTorrentsDB',
			'settings:enableCometTor',
			'settings:enableTorrentsDBTor',
			'settings:enableTorrentioTor',
			'settings:enableMediaFusionTor',
			'settings:enablePeerflixTor',
		]) {
			localStorage.setItem(key, 'true');
		}
		mockGet.mockResolvedValue({ data: { streams: [] } });
		const { result } = renderHook(() => useExternalSources('SECRETRDKEY'));

		const sources = result.current.getEnabledSources();
		await act(async () => {
			for (const source of sources) {
				await result.current.fetchMovieFromExternalSource('tt123', source as any);
				await result.current.fetchEpisodeFromExternalSource('tt123', 1, 1, source as any);
			}
		});

		expect(mockGet).toHaveBeenCalled();
		const sent = JSON.stringify(mockGet.mock.calls);
		const decoded = [...sent.matchAll(/[A-Za-z0-9+/=]{40,}/g)].map((m) => {
			try {
				return atob(m[0]);
			} catch {
				return '';
			}
		});
		expect(sent).not.toContain('SECRETRDKEY');
		expect(decoded.join(' ')).not.toContain('SECRETRDKEY');
		expect(sources).not.toContain('comet');
		expect(sources).not.toContain('torrentsdb');
	});
});
