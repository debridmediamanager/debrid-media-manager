import recorded from '@/test/fixtures/castMovieFailures/production-2026-10-14.json';
import { RD_NAME_REFUSED_MESSAGE, rdAddRefusedMessage } from '@/utils/rdAddPause';
import { rdBlockedCastMessage } from '@/utils/rdFilenameFilter';
import axios from 'axios';
import toast from 'react-hot-toast';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleCastMovieAllDebrid, handleCastTvShowAllDebrid } from './allDebridCastApiClient';
import { handleCastMovie, handleCastTvShow } from './castApiClient';
import { handleCastMovieDebridLink, handleCastTvShowDebridLink } from './debridLinkCastApiClient';
import { handleCastMovieOffcloud, handleCastTvShowOffcloud } from './offcloudCastApiClient';
import { handleCastMoviePremiumize, handleCastTvShowPremiumize } from './premiumizeCastApiClient';
import { handleCastMovieTorBox, handleCastTvShowTorBox } from './torboxCastApiClient';

vi.mock('axios');
vi.mock('react-hot-toast');
vi.mock('./allDebridCastClientPipeline', () => ({
	prepareMagnetForCast: vi.fn(async () => ({
		magnetId: 7,
		videoFiles: [{ path: 'Show.S01E01.mkv', size: 1, link: 'https://alldebrid.com/f/x' }],
	})),
	pickBiggestVideo: () => ({
		fileIndex: 0,
		link: 'https://alldebrid.com/f/x',
		filename: 'Movie.mkv',
		fileSize: 1,
	}),
	findVideoByName: (_files: unknown, filename: string) => ({
		fileIndex: 0,
		link: 'https://alldebrid.com/f/x',
		filename,
		fileSize: 1,
	}),
}));

const IMDB = 'tt31193180';
const HASH = '4d2e9e41c6dd2d2183888b90d5393d7ae472f1b6';

/** What axios rejects with for a non-2xx answer. */
const httpError = (status: number, body: unknown) =>
	Object.assign(new Error(`Request failed with status code ${status}`), {
		response: { status, data: body },
	});

const failWith = (status: number, body: unknown) => {
	vi.mocked(axios.get).mockRejectedValue(httpError(status, body));
	vi.mocked(axios.post).mockRejectedValue(httpError(status, body));
};

const movieCasts: Record<string, () => Promise<void>> = {
	rd: () => handleCastMovie(IMDB, 'key', HASH),
	tb: () => handleCastMovieTorBox(IMDB, 'key', HASH),
	ad: () => handleCastMovieAllDebrid(IMDB, 'key', HASH),
	pm: () => handleCastMoviePremiumize(IMDB, 'key', HASH),
	oc: () => handleCastMovieOffcloud(IMDB, 'key', HASH),
	dl: () => handleCastMovieDebridLink(IMDB, 'key', HASH),
};

const showCasts: Record<string, () => Promise<void>> = {
	rd: () => handleCastTvShow(IMDB, 'key', HASH, ['1', '2']),
	tb: () => handleCastTvShowTorBox(IMDB, 'key', HASH, ['1', '2']),
	ad: () =>
		handleCastTvShowAllDebrid(IMDB, 'key', HASH, [
			{ filename: 'Show.S01E01.mkv' },
			{ filename: 'Show.S01E02.mkv' },
		]),
	pm: () => handleCastTvShowPremiumize(IMDB, 'key', HASH),
	oc: () => handleCastTvShowOffcloud(IMDB, 'key', HASH),
	dl: () => handleCastTvShowDebridLink(IMDB, 'key', HASH),
};

beforeEach(() => {
	vi.clearAllMocks();
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

// The movie page wraps each cast in toast.promise and opens Stremio after it.
// The helpers caught every failure and resolved, so a refused cast showed the
// reason and then "Cast started in Stremio" over it, and opened Stremio.
describe('a movie cast that fails rejects with the reason', () => {
	it.each(Object.entries(recorded.responses))(
		'%s: what production answered on 2026-10-14',
		async (service, { status, body }) => {
			failWith(status, body);

			await expect(movieCasts[service]()).rejects.toThrow(body.errorMessage);
			expect(toast).not.toHaveBeenCalled();
		}
	);

	// Card 428's Prestige link, refused by the route since 9e408796.
	it('rd: a file name Real-Debrid refuses', async () => {
		const refused = rdBlockedCastMessage(
			'https://23-4.download.real-debrid.com/d/AAAAAAAAAAAAA/The.Prestige.2006.1080p.BluRay.x264-%5BYTS.AM%5D.mp4'
		)!;
		failWith(422, { status: 'error', errorMessage: refused });

		await expect(movieCasts.rd()).rejects.toThrow(refused);
	});

	it('rd: the account pausing adds', async () => {
		failWith(503, { status: 'error', errorMessage: rdAddRefusedMessage() });

		await expect(movieCasts.rd()).rejects.toThrow(rdAddRefusedMessage());
	});

	it.each(Object.keys(movieCasts))('%s: a cast that worked still resolves', async (service) => {
		const ok = { data: { filename: 'Movie.mkv' } };
		vi.mocked(axios.get).mockResolvedValue(ok);
		vi.mocked(axios.post).mockResolvedValue(ok);

		await expect(movieCasts[service]()).resolves.toBeUndefined();
	});
});

// The show page does the same with "Casting succeeded.".
describe('a series cast that casts nothing rejects with the reason', () => {
	it.each(Object.entries(recorded.responses))(
		'%s: the request itself failed',
		async (service, { status, body }) => {
			failWith(status, body);

			await expect(showCasts[service]()).rejects.toThrow(body.errorMessage);
			expect(toast.success).not.toHaveBeenCalled();
		}
	);

	// The series route answers 200 with the reason when RD refused the add.
	it.each([RD_NAME_REFUSED_MESSAGE, rdAddRefusedMessage()])(
		'rd: every episode refused: %s',
		async (reason) => {
			vi.mocked(axios.get).mockResolvedValue({
				data: { errorEpisodes: ['fileId:1', 'fileId:2'], errorMessage: reason },
			});

			await expect(showCasts.rd()).rejects.toThrow(reason);
			expect(toast.error).not.toHaveBeenCalled();
			expect(toast.success).not.toHaveBeenCalled();
		}
	);

	it.each(['tb', 'ad'])('%s: every episode failed', async (service) => {
		const resp = { data: { errorEpisodes: ['S01E01', 'S01E02'] } };
		vi.mocked(axios.get).mockResolvedValue(resp);
		vi.mocked(axios.post).mockResolvedValue(resp);

		await expect(showCasts[service]()).rejects.toThrow('Cast failed for S01E01 and 1 more');
	});

	it.each(['pm', 'oc', 'dl'])('%s: nothing cast', async (service) => {
		vi.mocked(axios.post).mockResolvedValue({
			data: { errorEpisodes: ['S01E01'], casted: 0 },
		});

		await expect(showCasts[service]()).rejects.toThrow('Cast failed for S01E01');
	});

	it.each(Object.keys(showCasts))(
		'%s: some episodes cast resolves and still names the rest',
		async (service) => {
			const resp = { data: { errorEpisodes: ['S01E02'], casted: 1 } };
			vi.mocked(axios.get).mockResolvedValue(resp);
			vi.mocked(axios.post).mockResolvedValue(resp);

			await expect(showCasts[service]()).resolves.toBeUndefined();
			expect(toast.error).toHaveBeenCalledWith(
				expect.stringContaining('Cast failed for S01E02'),
				expect.any(Object)
			);
		}
	);
});
