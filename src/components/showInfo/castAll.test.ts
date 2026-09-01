import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockToast, mockModalFire } = vi.hoisted(() => ({
	mockToast: Object.assign(vi.fn(), {
		loading: vi.fn(() => 'toast-id'),
		success: vi.fn(),
		error: vi.fn(),
		dismiss: vi.fn(),
	}),
	mockModalFire: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({ default: mockToast, toast: mockToast }));
vi.mock('../modals/modal', () => ({
	default: { fire: mockModalFire, showValidationMessage: vi.fn() },
}));

import { bindCastAllButton } from './castAll';

const click = async () => {
	document.getElementById('btn-cast-all')!.dispatchEvent(new Event('click'));
	// let the handler's promise chain settle
	await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('bindCastAllButton', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		document.body.innerHTML = '<button id="btn-cast-all"></button>';
		Object.defineProperty(window, 'location', {
			value: { href: '' },
			writable: true,
		});
	});

	// The key used to ride in the query string, which writes it verbatim into the
	// nginx and Cloudflare access logs on dmm-01 - and an RD apitoken never
	// expires. It must travel as a bearer token and never appear in the URL.
	it('sends the key as a bearer token, never in the URL', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue({ json: async () => ({ status: 'success', redirectUrl: '/x' }) });
		vi.stubGlobal('fetch', fetchMock);

		bindCastAllButton({
			buttonId: 'btn-cast-all',
			castUrl: '/api/stremio/cast/library/1:abc',
			apiKey: 'SECRET-TOKEN',
			filename: 'Movie.mkv',
		});
		await click();

		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('/api/stremio/cast/library/1:abc');
		expect(url).not.toContain('SECRET-TOKEN');
		expect(init.headers.Authorization).toBe('Bearer SECRET-TOKEN');
	});

	it('keeps the key out of the URL on the IMDB retry too', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce({
				json: async () => ({ status: 'need_imdb_id', torrentInfo: {} }),
			})
			.mockResolvedValueOnce({
				json: async () => ({ status: 'success', redirectUrl: '/x' }),
			});
		vi.stubGlobal('fetch', fetchMock);
		mockModalFire.mockResolvedValue({ isConfirmed: true, value: 'tt1234567' });

		bindCastAllButton({
			buttonId: 'btn-cast-all',
			castUrl: '/api/stremio-pm/cast/library/abc',
			apiKey: 'SECRET-TOKEN',
			filename: 'Movie.mkv',
		});
		await click();

		const [retryUrl, retryInit] = fetchMock.mock.calls[1];
		expect(retryUrl).toBe('/api/stremio-pm/cast/library/abc?imdbId=tt1234567');
		expect(retryUrl).not.toContain('SECRET-TOKEN');
		expect(retryInit.headers.Authorization).toBe('Bearer SECRET-TOKEN');
	});

	it('appends imdbId with & when the url already has a query', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce({
				json: async () => ({ status: 'need_imdb_id', torrentInfo: {} }),
			})
			.mockResolvedValueOnce({
				json: async () => ({ status: 'success', redirectUrl: '/x' }),
			});
		vi.stubGlobal('fetch', fetchMock);
		mockModalFire.mockResolvedValue({ isConfirmed: true, value: 'tt1234567' });

		bindCastAllButton({
			buttonId: 'btn-cast-all',
			castUrl: '/api/x?a=1',
			apiKey: 'k',
			filename: 'f',
		});
		await click();
		expect(fetchMock.mock.calls[1][0]).toBe('/api/x?a=1&imdbId=tt1234567');
	});

	it('does nothing when the user cancels the IMDB prompt', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue({ json: async () => ({ status: 'need_imdb_id', torrentInfo: {} }) });
		vi.stubGlobal('fetch', fetchMock);
		mockModalFire.mockResolvedValue({ isConfirmed: false });

		bindCastAllButton({
			buttonId: 'btn-cast-all',
			castUrl: '/api/x',
			apiKey: 'k',
			filename: 'f',
		});
		await click();

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(mockToast.error).not.toHaveBeenCalled();
	});

	it('surfaces the server error message', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				json: async () => ({ status: 'error', errorMessage: 'nope' }),
			})
		);
		bindCastAllButton({
			buttonId: 'btn-cast-all',
			castUrl: '/api/x',
			apiKey: 'k',
			filename: 'f',
		});
		await click();
		expect(mockToast.error).toHaveBeenCalledWith('nope', expect.anything());
	});

	it('is a no-op when the button is not rendered', () => {
		document.body.innerHTML = '';
		expect(() =>
			bindCastAllButton({
				buttonId: 'btn-cast-all',
				castUrl: '/api/x',
				apiKey: 'k',
				filename: 'f',
			})
		).not.toThrow();
	});
});
