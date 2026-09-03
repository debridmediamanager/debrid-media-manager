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
	handleCastMovieDebridLink,
	handleCastTvShowDebridLink,
	saveDebridLinkCastProfile,
} from './debridLinkCastApiClient';

const HASH = 'fbadffe5476df0674dbec75e81426895e40b6427';

describe('debridLinkCastApiClient', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	// The add answers with the release's whole file list, so the browser sends
	// nothing but the hash - and the button is never gated on a client-side file
	// list, which Debrid-Link could not supply anyway (no cache probe exists).
	it('casts the whole series with a single request carrying only the hash', async () => {
		axiosMock.post.mockResolvedValue({ data: { status: 'success', casted: 8 } });

		await handleCastTvShowDebridLink('tt999', 'dl-token', HASH);

		expect(axiosMock.post).toHaveBeenCalledTimes(1);
		const [url, body, config] = axiosMock.post.mock.calls[0];
		expect(url).toBe('/api/stremio-dl/cast/series/tt999');
		expect(body).toEqual({ hash: HASH });
		expect(config).toMatchObject({ headers: { Authorization: 'Bearer dl-token' } });
		expect(toastMock.success).toHaveBeenCalledWith(
			expect.stringContaining('8 episodes'),
			expect.anything()
		);
	});

	it('surfaces the episodes the server could not cast', async () => {
		axiosMock.post.mockResolvedValue({
			data: { status: 'partial', casted: 1, errorEpisodes: ['Show.S01E02.mkv', 'x.mkv'] },
		});

		await handleCastTvShowDebridLink('tt999', 'dl-token', HASH);

		expect(toastMock.error).toHaveBeenCalledWith(
			expect.stringContaining('Show.S01E02.mkv'),
			expect.anything()
		);
	});

	// The quota refusals are the whole reason the server spells its errors out -
	// a cast that costs one of 50 daily torrents has to say so.
	it('reports the server error message when the cast fails outright', async () => {
		axiosMock.post.mockRejectedValue({
			response: {
				data: { errorMessage: 'Debrid-Link daily torrent quota reached (50 per day)' },
			},
		});

		await handleCastTvShowDebridLink('tt999', 'dl-token', HASH);

		expect(toastMock.error).toHaveBeenCalledWith(
			expect.stringContaining('50 per day'),
			expect.anything()
		);
		expect(toastMock.success).not.toHaveBeenCalled();
	});

	// Debrid-Link accepts `?access_token=` as well as the header, which is a live
	// log-leak path - so the credential only ever rides in the header.
	it('sends the movie cast credential as a bearer token', async () => {
		axiosMock.get.mockResolvedValue({ data: { filename: 'Movie.mkv' } });

		await handleCastMovieDebridLink('tt123', 'dl-token', HASH);

		const [url, config] = axiosMock.get.mock.calls[0];
		expect(url).toBe(`/api/stremio-dl/cast/movie/tt123?hash=${HASH}`);
		expect(url).not.toContain('dl-token');
		expect(config).toMatchObject({ headers: { Authorization: 'Bearer dl-token' } });
	});

	it('sends a refresh token only when the browser holds one', async () => {
		axiosMock.post.mockResolvedValue({ data: { profile: { userId: 'u1' } } });

		await saveDebridLinkCastProfile('dl-token', {});
		expect(axiosMock.post.mock.calls[0][1]).not.toHaveProperty('refreshToken');

		await saveDebridLinkCastProfile('dl-token', {}, 'refresh-1');
		expect(axiosMock.post.mock.calls[1][1]).toMatchObject({ refreshToken: 'refresh-1' });
	});

	it('returns null rather than throwing when the profile save fails', async () => {
		axiosMock.post.mockRejectedValue(new Error('boom'));
		expect(await saveDebridLinkCastProfile('dl-token')).toBeNull();
	});
});
