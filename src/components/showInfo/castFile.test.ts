import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockToast } = vi.hoisted(() => ({
	mockToast: Object.assign(vi.fn(), {
		loading: vi.fn(() => 'toast-id'),
		success: vi.fn(),
		error: vi.fn(),
		dismiss: vi.fn(),
	}),
}));

vi.mock('react-hot-toast', () => ({ default: mockToast, toast: mockToast }));

import { bindCastFileButtons } from './castFile';
import { renderTorrentInfo } from './render';

const HASH = '0123456789abcdef0123456789abcdef01234567';
const KEY = 'RDKEYSHOULDNEVERREACHAURL';

// The rows come from the real renderer, so the test exercises the markup the
// info window actually shows rather than a hand-written approximation of it.
const mountRow = (path: string, mediaType: 'movie' | 'tv') => {
	const html = renderTorrentInfo(
		{
			id: 'ABC',
			hash: HASH,
			status: 'downloaded',
			fake: false,
			files: [{ id: 7, path, bytes: 1024, selected: 1 }],
			links: ['https://real-debrid.com/d/ABCDEFGHIJKLM'],
		},
		true,
		KEY,
		'mac2',
		'tt1234567',
		mediaType
	);
	document.body.innerHTML = `<table><tbody>${html}</tbody></table>`;
};

const click = async () => {
	document.querySelector<HTMLButtonElement>('button[data-cast-file-id]')!.click();
	await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('bindCastFileButtons', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		Object.defineProperty(window, 'location', { value: { href: '' }, writable: true });
	});

	it('sends the key as a bearer token and never in the URL', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				status: 'success',
				redirectUrl: 'stremio:///detail/movie/tt1234567/tt1234567',
				message: 'You can now stream the movie in Stremio',
			}),
		});
		vi.stubGlobal('fetch', fetchMock);
		mountRow('Movie.2020.1080p.mkv', 'movie');

		bindCastFileButtons({ imdbId: 'tt1234567', hash: HASH, mediaType: 'movie', apiKey: KEY });
		await click();

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).not.toContain(KEY);
		expect(url).not.toMatch(/[?&]token=/);
		expect(url).toBe(`/api/stremio/cast/tt1234567?hash=${HASH}&fileId=7&mediaType=movie`);
		expect(init.headers.Authorization).toBe(`Bearer ${KEY}`);
		expect(window.location.href).toBe('stremio:///detail/movie/tt1234567/tt1234567');
	});

	it('casts an episode row with its media type', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				status: 'success',
				redirectUrl: 'stremio:///detail/series/tt1234567/tt1234567:1:2',
			}),
		});
		vi.stubGlobal('fetch', fetchMock);
		mountRow('Show.S01E02.1080p.mkv', 'tv');

		bindCastFileButtons({ imdbId: 'tt1234567', hash: HASH, mediaType: 'tv', apiKey: KEY });
		await click();

		expect(fetchMock.mock.calls[0][0]).toBe(
			`/api/stremio/cast/tt1234567?hash=${HASH}&fileId=7&mediaType=tv`
		);
		expect(window.location.href).toBe('stremio:///detail/series/tt1234567/tt1234567:1:2');
	});

	it('shows the server error and stays on the page when the cast fails', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: false,
				json: async () => ({
					status: 'error',
					errorMessage: 'Could not read a season and episode from the filename',
				}),
			})
		);
		mountRow('Movie.2020.1080p.mkv', 'movie');

		bindCastFileButtons({ imdbId: 'tt1234567', hash: HASH, mediaType: 'movie', apiKey: KEY });
		await click();

		expect(mockToast.error).toHaveBeenCalledWith(
			'Could not read a season and episode from the filename',
			expect.anything()
		);
		expect(window.location.href).toBe('');
		// The button is usable again for a retry.
		expect(
			document.querySelector<HTMLButtonElement>('button[data-cast-file-id]')!.disabled
		).toBe(false);
	});

	it('binds each button once even when called again', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ status: 'success', redirectUrl: 'stremio:///x' }),
		});
		vi.stubGlobal('fetch', fetchMock);
		mountRow('Movie.2020.1080p.mkv', 'movie');

		const options = {
			imdbId: 'tt1234567',
			hash: HASH,
			mediaType: 'movie' as const,
			apiKey: KEY,
		};
		bindCastFileButtons(options);
		bindCastFileButtons(options);
		await click();

		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});
