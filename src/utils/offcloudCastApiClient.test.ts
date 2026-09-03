import { beforeEach, describe, expect, it, vi } from 'vitest';

const axiosMock = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn(), delete: vi.fn() }));
vi.mock('axios', () => ({ default: axiosMock }));

const toastMock = vi.hoisted(() => {
	const toast: any = vi.fn();
	toast.success = vi.fn();
	toast.error = vi.fn();
	return toast;
});
vi.mock('react-hot-toast', () => ({ default: toastMock }));

vi.mock('@/hooks/useSponsor', () => ({ sponsorHeaders: () => ({}) }));

import {
	handleCastMovieOffcloud,
	handleCastTvShowOffcloud,
	saveOffcloudCastProfile,
} from './offcloudCastApiClient';

const HASH = 'fbadffe5476df0674dbec75e81426895e40b6427';

describe('offcloudCastApiClient', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	// One stateless `cache/info` on the server resolves the whole release, so the
	// browser sends nothing but the hash - and the button is never gated on a
	// client-side file list.
	it('casts the whole series with a single request carrying only the hash', async () => {
		axiosMock.post.mockResolvedValue({ data: { status: 'success', casted: 8 } });

		await handleCastTvShowOffcloud('tt999', 'oc-key', HASH);

		expect(axiosMock.post).toHaveBeenCalledTimes(1);
		const [url, body, config] = axiosMock.post.mock.calls[0];
		expect(url).toBe('/api/stremio-oc/cast/series/tt999');
		expect(body).toEqual({ hash: HASH });
		expect(config).toMatchObject({ headers: { Authorization: 'Bearer oc-key' } });
		expect(toastMock.success).toHaveBeenCalledWith(
			expect.stringContaining('8 episodes'),
			expect.anything()
		);
	});

	it('surfaces the episodes the server could not cast', async () => {
		axiosMock.post.mockResolvedValue({
			data: { status: 'partial', casted: 1, errorEpisodes: ['Show.S01E02.mkv', 'x.mkv'] },
		});

		await handleCastTvShowOffcloud('tt999', 'oc-key', HASH);

		expect(toastMock.error).toHaveBeenCalledWith(
			expect.stringContaining('Show.S01E02.mkv'),
			expect.anything()
		);
	});

	it('reports the server error message when the cast fails outright', async () => {
		axiosMock.post.mockRejectedValue({
			response: { data: { errorMessage: 'Not cached on Offcloud' } },
		});

		await handleCastTvShowOffcloud('tt999', 'oc-key', HASH);

		expect(toastMock.error).toHaveBeenCalledWith('Not cached on Offcloud', expect.anything());
		expect(toastMock.success).not.toHaveBeenCalled();
	});

	// The API key is the whole Offcloud account - no scoping, no per-app keys -
	// so it rides in the Authorization header and never in the query string.
	it('sends the movie cast key as a bearer token', async () => {
		axiosMock.get.mockResolvedValue({ data: { filename: 'Movie.mkv' } });

		await handleCastMovieOffcloud('tt123', 'oc-key', HASH);

		const [url, config] = axiosMock.get.mock.calls[0];
		expect(url).toBe(`/api/stremio-oc/cast/movie/tt123?hash=${HASH}`);
		expect(config).toMatchObject({ headers: { Authorization: 'Bearer oc-key' } });
	});

	it('returns null rather than throwing when the profile save fails', async () => {
		axiosMock.post.mockRejectedValue(new Error('boom'));
		expect(await saveOffcloudCastProfile('oc-key')).toBeNull();
	});
});
