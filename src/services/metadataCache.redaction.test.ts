import { format } from 'util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MetadataCacheService, redactUrl } from './metadataCache';

// Fizzy #221. Production logged every OMDb request URL with DMM's key in it:
// on 2026-10-04 each dmm-01 container wrote 16 lines like
//   [MetadataCache] Fetching omdb_info data from: https://www.omdbapi.com/?i=tt30403339&apikey=<key>
// in its first 40 minutes, and 26 more carrying TMDB's v3 `api_key`. A failed
// request was worse: the Axios error repeats the URL in `config.url` and in the
// raw request line, and `settle`, `getOmdbMetadata` and the info routes all log
// the error whole.

vi.mock('next/config', () => ({ default: () => ({ publicRuntimeConfig: {} }) }));

const cache = vi.hoisted(() => ({ getWithMetadata: vi.fn(), set: vi.fn() }));
vi.mock('./database/mdblistCache', () => ({ getMdblistCacheService: () => cache }));

const axiosGet = vi.hoisted(() => vi.fn());
vi.mock('axios', () => ({ default: { get: axiosGet } }));

const OMDB_KEY = 'omdb-key-5f3a9c';
const TMDB_KEY = 'tmdb-key-8e21d4';
const TMDB_TOKEN = 'tmdb-read-token-77b0';

/** Everything the service wrote to the console, formatted as Node prints it. */
let logged: string[] = [];

/**
 * A real AxiosError for a refused request, carrying the URL in each place Node's
 * http adapter puts it: the config, and the request's path and header.
 */
async function refusedRequest(url: string, headers: Record<string, string> = {}) {
	const { AxiosError } = await vi.importActual<typeof import('axios')>('axios');
	const { pathname, search } = new URL(url);
	const request = {
		path: `${pathname}${search}`,
		_header: `GET ${pathname}${search} HTTP/1.1\r\nHost: example\r\n\r\n`,
	};
	const config = { url, method: 'get', headers } as any;
	return new AxiosError(
		'Request failed with status code 401',
		'ERR_BAD_REQUEST',
		config,
		request,
		{
			status: 401,
			statusText: 'Unauthorized',
			headers: {},
			config,
			request,
			data: { Response: 'False', Error: 'Invalid API key!' },
		} as any
	);
}

beforeEach(() => {
	logged = [];
	for (const level of ['log', 'warn', 'error'] as const) {
		vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
			logged.push(format(...args));
		});
	}
	cache.getWithMetadata.mockReset().mockResolvedValue(null);
	cache.set.mockReset().mockResolvedValue(undefined);
	axiosGet.mockReset();
	vi.stubEnv('OMDB_KEY', OMDB_KEY);
	vi.stubEnv('TMDB_KEY', TMDB_KEY);
	vi.stubEnv('TMDB_READ_TOKEN', '');
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});

describe('MetadataCacheService keeps provider keys out of its logs', () => {
	it('logs the OMDb request it makes without the key', async () => {
		axiosGet.mockResolvedValue({ data: { Response: 'True', Title: 'Filth' } });

		await new MetadataCacheService().getOmdbInfo('tt30403339');

		expect(axiosGet.mock.calls[0][0]).toContain(`apikey=${OMDB_KEY}`);
		expect(logged.join('\n')).toContain('www.omdbapi.com/?i=tt30403339&apikey=REDACTED');
		expect(logged.join('\n')).not.toContain(OMDB_KEY);
	});

	it('logs a TMDB request without its v3 api_key', async () => {
		axiosGet.mockResolvedValue({ data: { id: 111102, title: 'Filth' } });

		await new MetadataCacheService().getTmdbMovieInfo(111102);

		expect(axiosGet.mock.calls[0][0]).toContain(`api_key=${TMDB_KEY}`);
		expect(logged.join('\n')).not.toContain(TMDB_KEY);
	});

	it('throws a failed request without the key, keeping the shape callers branch on', async () => {
		axiosGet.mockImplementation(async (url: string) => {
			throw await refusedRequest(url);
		});

		const error = await new MetadataCacheService().getOmdbInfo('tt1046922').then(
			() => null,
			(e) => e
		);

		// getOmdbMetadata, settle() and the info routes log this object whole.
		console.warn('[OMDb] lookup failed for tt1046922', error);
		expect(error?.isAxiosError).toBe(true);
		expect(error?.response?.status).toBe(401);
		expect(error?.config?.url).toBe('https://www.omdbapi.com/?i=tt1046922&apikey=REDACTED');
		expect(format(error)).not.toContain(OMDB_KEY);
		expect(logged.join('\n')).not.toContain(OMDB_KEY);
	});

	it('logs the error behind a stale row without the key', async () => {
		cache.getWithMetadata.mockResolvedValue({
			data: { Response: 'True', Title: 'Filth', Type: 'movie' },
			updatedAt: new Date(0),
		});
		axiosGet.mockImplementation(async (url: string) => {
			throw await refusedRequest(url);
		});

		const data = await new MetadataCacheService().getOmdbInfo('tt1046922');

		expect(data).toMatchObject({ Title: 'Filth' });
		expect(logged.join('\n')).toContain('serving stale omdb_info');
		expect(logged.join('\n')).not.toContain(OMDB_KEY);
	});

	it("keeps TMDB's v4 bearer token out of a logged error", async () => {
		vi.stubEnv('TMDB_READ_TOKEN', TMDB_TOKEN);
		axiosGet.mockImplementation(async (url: string, config: any) => {
			throw await refusedRequest(url, config.headers);
		});

		const error = await new MetadataCacheService().getTmdbTvInfo(1396).then(
			() => null,
			(e) => e
		);

		expect(error?.response?.status).toBe(401);
		expect(format(error)).not.toContain(TMDB_TOKEN);
	});
});

describe('redactUrl', () => {
	it('blanks every credential parameter and leaves the rest of the URL', () => {
		expect(
			redactUrl(
				'https://api.themoviedb.org/3/find/tt1046922?api_key=abc123&external_source=imdb_id'
			)
		).toBe(
			'https://api.themoviedb.org/3/find/tt1046922?api_key=REDACTED&external_source=imdb_id'
		);
		expect(redactUrl('https://www.omdbapi.com/?s=filth&y=&apikey=abc123&type=movie')).toBe(
			'https://www.omdbapi.com/?s=filth&y=&apikey=REDACTED&type=movie'
		);
		expect(redactUrl('https://v3-cinemeta.strem.io/meta/movie/tt1046922.json')).toBe(
			'https://v3-cinemeta.strem.io/meta/movie/tt1046922.json'
		);
	});
});
