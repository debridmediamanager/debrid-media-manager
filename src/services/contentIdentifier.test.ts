import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	forgetIdentifications,
	identifyFilenames,
	identifyFilenamesRemembered,
} from './contentIdentifier';

const result = { confident: true, matches: [] };

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

describe('identifyFilenames', () => {
	it('is unavailable until a URL is configured', async () => {
		vi.stubEnv('CONTENT_IDENTIFIER_URL', '');
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		expect(await identifyFilenames(['x'])).toBeNull();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('sends the token and splits at the service ceiling, keeping order', async () => {
		vi.stubEnv('CONTENT_IDENTIFIER_URL', 'http://identifier.example:3400/');
		vi.stubEnv('CONTENT_IDENTIFIER_TOKEN', 's3cret');
		const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
			const { filenames } = JSON.parse(init.body as string) as { filenames: string[] };
			return new Response(JSON.stringify({ results: filenames.map(() => result) }));
		});
		vi.stubGlobal('fetch', fetchMock);

		const names = Array.from({ length: 1500 }, (_, i) => `Movie.${i}.2020`);
		const out = await identifyFilenames(names);

		expect(out).toHaveLength(1500);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('http://identifier.example:3400/identify/batch');
		expect((init.headers as Record<string, string>)['x-identifier-token']).toBe('s3cret');
		expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toMatchObject({
			filenames: expect.arrayContaining(['Movie.1000.2020']),
			kind: 'auto',
		});
	});

	it('gives up on a refusal or an unreachable service', async () => {
		vi.stubEnv('CONTENT_IDENTIFIER_URL', 'http://identifier.example:3400');
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(new Response('bad token', { status: 401 }))
		);
		expect(await identifyFilenames(['x'])).toBeNull();
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
		expect(await identifyFilenames(['x'])).toBeNull();
	});
});

describe('identifyFilenamesRemembered', () => {
	const answering = () =>
		vi.fn(async (_url: string, init: RequestInit) => {
			const { filenames } = JSON.parse(init.body as string) as { filenames: string[] };
			return new Response(JSON.stringify({ results: filenames.map(() => result) }));
		});

	it('asks about a name once and about no more new names than allowed', async () => {
		forgetIdentifications();
		vi.stubEnv('CONTENT_IDENTIFIER_URL', 'http://identifier.example:3400');
		const fetchMock = answering();
		vi.stubGlobal('fetch', fetchMock);
		const names = ['a', 'b', 'c', 'd', 'e'];

		const first = await identifyFilenamesRemembered(names, 3);
		expect(first?.complete).toBe(false);
		expect([...first!.answers.keys()]).toEqual(['a', 'b', 'c']);

		const second = await identifyFilenamesRemembered(names, 3);
		expect(second?.complete).toBe(true);
		expect(second!.answers.size).toBe(5);
		const asked = fetchMock.mock.calls.map(
			(c) => JSON.parse((c[1] as RequestInit).body as string).filenames
		);
		expect(asked).toEqual([
			['a', 'b', 'c'],
			['d', 'e'],
		]);

		await identifyFilenamesRemembered(names, 3);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('remembers nothing from a failed call', async () => {
		forgetIdentifications();
		vi.stubEnv('CONTENT_IDENTIFIER_URL', 'http://identifier.example:3400');
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
		expect(await identifyFilenamesRemembered(['x'], 10)).toBeNull();
		const fetchMock = answering();
		vi.stubGlobal('fetch', fetchMock);
		expect((await identifyFilenamesRemembered(['x'], 10))?.answers.size).toBe(1);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});
