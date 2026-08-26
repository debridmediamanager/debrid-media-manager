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

import { handleCastTvShowPremiumize } from './premiumizeCastApiClient';

const HASH = 'fbadffe5476df0674dbec75e81426895e40b6427';

describe('handleCastTvShowPremiumize', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	// Premiumize's cache probe returns no file listing, so the browser has no
	// episode filenames to send - the server resolves the release itself. One
	// request also means one `directdl`, where the old per-5 batching spent one
	// per batch.
	it('casts the whole release with a single request carrying only the hash', async () => {
		axiosMock.post.mockResolvedValue({ data: { status: 'success', casted: 8 } });

		await handleCastTvShowPremiumize('tt999', 'pm-key', HASH);

		expect(axiosMock.post).toHaveBeenCalledTimes(1);
		const [url, body, config] = axiosMock.post.mock.calls[0];
		expect(url).toBe('/api/stremio-pm/cast/series/tt999');
		expect(body).toEqual({ hash: HASH });
		expect(config).toMatchObject({ headers: { Authorization: 'Bearer pm-key' } });
		expect(toastMock.success).toHaveBeenCalledWith(
			expect.stringContaining('8 episodes'),
			expect.anything()
		);
	});

	it('surfaces the episodes the server could not cast', async () => {
		axiosMock.post.mockResolvedValue({
			data: { status: 'partial', casted: 1, errorEpisodes: ['Show.S01E02.mkv', 'x.mkv'] },
		});

		await handleCastTvShowPremiumize('tt999', 'pm-key', HASH);

		expect(toastMock.error).toHaveBeenCalledWith(
			expect.stringContaining('Show.S01E02.mkv'),
			expect.anything()
		);
	});

	it('reports the server error message when the cast fails outright', async () => {
		axiosMock.post.mockRejectedValue({
			response: { data: { errorMessage: 'No episodes in this release on Premiumize' } },
		});

		await handleCastTvShowPremiumize('tt999', 'pm-key', HASH);

		expect(toastMock.error).toHaveBeenCalledWith(
			'No episodes in this release on Premiumize',
			expect.anything()
		);
		expect(toastMock.success).not.toHaveBeenCalled();
	});
});
