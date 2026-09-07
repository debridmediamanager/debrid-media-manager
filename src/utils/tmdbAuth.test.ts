import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	TMDB_BASE_URL,
	getTmdbAuth,
	getTmdbAuthWithFreeKey,
	tmdbAxiosOptions,
	tmdbRequestConfig,
	tmdbUrl,
} from './tmdbAuth';

describe('getTmdbAuth', () => {
	const saved = { key: process.env.TMDB_KEY, token: process.env.TMDB_READ_TOKEN };

	beforeEach(() => {
		delete process.env.TMDB_KEY;
		delete process.env.TMDB_READ_TOKEN;
	});

	afterEach(() => {
		if (saved.key === undefined) delete process.env.TMDB_KEY;
		else process.env.TMDB_KEY = saved.key;
		if (saved.token === undefined) delete process.env.TMDB_READ_TOKEN;
		else process.env.TMDB_READ_TOKEN = saved.token;
	});

	it('returns null when nothing is configured', () => {
		expect(getTmdbAuth()).toBeNull();
	});

	it('uses the v3 key as a query parameter', () => {
		process.env.TMDB_KEY = 'v3key';
		expect(getTmdbAuth()).toEqual({ headers: {}, apiKey: 'v3key' });
	});

	it('uses the v4 token as a bearer header', () => {
		process.env.TMDB_READ_TOKEN = 'v4token';
		expect(getTmdbAuth()).toEqual({
			headers: { Authorization: 'Bearer v4token' },
			apiKey: null,
		});
	});

	it('prefers the v4 token when both are set', () => {
		process.env.TMDB_KEY = 'v3key';
		process.env.TMDB_READ_TOKEN = 'v4token';
		expect(getTmdbAuth()?.apiKey).toBeNull();
		expect(getTmdbAuth()?.headers.Authorization).toBe('Bearer v4token');
	});

	it('accepts a caller-supplied fallback key', () => {
		expect(getTmdbAuth('runtime')).toEqual({ headers: {}, apiKey: 'runtime' });
	});

	it('ignores blank values', () => {
		process.env.TMDB_KEY = '   ';
		process.env.TMDB_READ_TOKEN = '  ';
		expect(getTmdbAuth()).toBeNull();
	});

	it('falls back to the shared free-key pool only when asked', () => {
		expect(getTmdbAuth()).toBeNull();
		const auth = getTmdbAuthWithFreeKey();
		expect(auth.apiKey).toMatch(/^[0-9a-f]{32}$/);
	});
});

describe('tmdbUrl', () => {
	it('appends the api key when authenticating by key', () => {
		const url = tmdbUrl('/movie/550', {}, { headers: {}, apiKey: 'v3key' });
		expect(url).toBe(`${TMDB_BASE_URL}/movie/550?api_key=v3key`);
	});

	it('omits the api key when authenticating by bearer token', () => {
		const url = tmdbUrl(
			'/movie/550',
			{},
			{ headers: { Authorization: 'Bearer x' }, apiKey: null }
		);
		expect(url).toBe(`${TMDB_BASE_URL}/movie/550`);
	});

	it('serialises extra parameters', () => {
		const url = tmdbUrl(
			'/find/tt123',
			{ external_source: 'imdb_id' },
			{ headers: {}, apiKey: 'k' }
		);
		expect(url).toBe(`${TMDB_BASE_URL}/find/tt123?api_key=k&external_source=imdb_id`);
	});

	it('drops undefined, null and empty parameters', () => {
		const url = tmdbUrl(
			'/tv/1',
			{ a: undefined, b: null, c: '', d: 0 },
			{ headers: {}, apiKey: null }
		);
		expect(url).toBe(`${TMDB_BASE_URL}/tv/1?d=0`);
	});

	it('normalizes a path given without a leading slash', () => {
		expect(tmdbUrl('movie/550', {}, { headers: {}, apiKey: null })).toBe(
			`${TMDB_BASE_URL}/movie/550`
		);
	});
});

describe('tmdbRequestConfig', () => {
	it('carries the bearer header', () => {
		expect(tmdbRequestConfig({ headers: { Authorization: 'Bearer x' }, apiKey: null })).toEqual(
			{
				headers: { Authorization: 'Bearer x' },
			}
		);
	});

	it('is empty for key auth', () => {
		expect(tmdbRequestConfig({ headers: {}, apiKey: 'k' })).toEqual({ headers: {} });
	});
});

describe('tmdbAxiosOptions', () => {
	it('includes api_key under key auth', () => {
		expect(tmdbAxiosOptions({ headers: {}, apiKey: 'k' }, { language: 'en' })).toEqual({
			headers: {},
			params: { api_key: 'k', language: 'en' },
		});
	});

	it('omits api_key under bearer auth', () => {
		const auth = { headers: { Authorization: 'Bearer x' }, apiKey: null };
		expect(tmdbAxiosOptions(auth, { language: 'en' })).toEqual({
			headers: { Authorization: 'Bearer x' },
			params: { language: 'en' },
		});
	});

	it('drops undefined parameters', () => {
		expect(tmdbAxiosOptions({ headers: {}, apiKey: null }, { a: undefined, b: 1 })).toEqual({
			headers: {},
			params: { b: 1 },
		});
	});
});
