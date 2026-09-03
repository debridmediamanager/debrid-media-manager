import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	CACHE_CHECK_CHUNK_SIZE,
	OffcloudError,
	addOffcloudCloud,
	checkOffcloudCache,
	exploreOffcloudCloud,
	extractBtih,
	getOffcloudAccountInfo,
	getOffcloudCacheInfo,
	getOffcloudCloudStatus,
	getOffcloudHistory,
	isOffcloudPremium,
	isValidBtih,
	joinExploreWithCacheInfo,
	removeOffcloudCloud,
	toMagnetUri,
} from './offcloud';

const HASH = 'dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c';
const MAGNET = `magnet:?xt=urn:btih:${HASH}`;
const CDN = 'https://1-cdn2-ovh-fra.energycdn.com/cdn3sto/littlemouse-sto/obj/100000001/1/tok/sig';

const jsonResponse = (body: unknown, status = 200) =>
	({
		ok: status >= 200 && status < 300,
		status,
		headers: { get: (name: string) => (name === 'content-type' ? 'application/json' : null) },
		json: async () => body,
	}) as unknown as Response;

/**
 * Offcloud's HTML 404 page and Symfony's HTML 405 page both arrive with a
 * 200-family content type, so this is what a routing mistake looks like.
 */
const htmlResponse = (status = 200) =>
	({
		ok: status >= 200 && status < 300,
		status,
		headers: { get: () => 'text/html; charset=UTF-8' },
		json: async () => {
			throw new SyntaxError('Unexpected token <');
		},
	}) as unknown as Response;

const fetchMock = vi.fn();
const lastCall = () => fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
const lastBody = () => JSON.parse(lastCall()[1].body);

beforeEach(() => {
	fetchMock.mockReset();
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('offcloud transport', () => {
	it('sends the key in a header and never in the URL', async () => {
		fetchMock.mockResolvedValue(jsonResponse({ user_id: '100000001', is_premium: true }));

		await getOffcloudAccountInfo('secretkey');

		const [url, init] = lastCall();
		expect(url).toBe('https://offcloud.com/api/account/info');
		expect(url).not.toContain('secretkey');
		expect(init.method).toBe('GET');
		expect(init.headers.Authorization).toBe('Bearer secretkey');
	});

	it('rejects a missing key without touching the network', async () => {
		await expect(getOffcloudAccountInfo('')).rejects.toMatchObject({
			code: 'authentication_failed',
		});
		expect(fetchMock).not.toHaveBeenCalled();
	});

	// The trap this guard exists for: an unknown path or a wrong verb answers
	// with an HTML page under a 200, so a JSON-assuming client throws a
	// SyntaxError from somewhere unrelated instead of reporting the routing
	// mistake.
	it('reports an HTML body under a 200 rather than throwing on the parse', async () => {
		fetchMock.mockResolvedValue(htmlResponse(200));

		const failure = await getOffcloudAccountInfo('key').catch((e) => e);

		expect(failure).toBeInstanceOf(OffcloudError);
		expect(failure.code).toBe('non_json_response');
		expect(failure.message).toContain('text/html');
	});

	it('reports an HTML 405 from a wrong verb the same way', async () => {
		fetchMock.mockResolvedValue(htmlResponse(405));

		await expect(getOffcloudAccountInfo('key')).rejects.toMatchObject({
			code: 'non_json_response',
		});
	});

	it('maps the 401 NOAUTH body to a typed error', async () => {
		fetchMock.mockResolvedValue(jsonResponse({ error: 'NOAUTH' }, 401));

		const failure = await getOffcloudAccountInfo('revoked').catch((e) => e);

		expect(failure).toBeInstanceOf(OffcloudError);
		// One string for missing, malformed and revoked keys alike - there is no
		// oracle telling them apart, so nothing should try.
		expect(failure.code).toBe('NOAUTH');
	});

	it('treats an `error` field as a failure whatever the status', async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({ error: 'Missing required parameter: url' }, 200)
		);

		await expect(getOffcloudAccountInfo('key')).rejects.toMatchObject({
			code: 'Missing required parameter: url',
		});
	});

	it('surfaces the bare-string 500 body the add endpoint returns', async () => {
		fetchMock.mockResolvedValue(jsonResponse('Error parsing url - HTTP code: 404 ', 500));

		await expect(
			addOffcloudCloud('key', 'https://example.com/x.torrent')
		).rejects.toMatchObject({
			code: 'http_500',
			message: 'Error parsing url - HTTP code: 404 ',
		});
	});
});

describe('isValidBtih', () => {
	it('accepts both info hash forms', () => {
		expect(isValidBtih(HASH)).toBe(true);
		expect(isValidBtih(HASH.toUpperCase())).toBe(true);
		// 32-char base32, the other magnet form
		expect(isValidBtih('C7DPY3IRPI4TAIAM3SCH5CQMKQPMKPIY')).toBe(true);
	});

	// The zombie: Offcloud accepts this with a 200 and a requestId, then parks
	// it in `created`/"Loading..." indefinitely. Nothing upstream refuses it.
	it('refuses the garbage magnet that becomes a zombie', () => {
		expect(isValidBtih('zzzz')).toBe(false);
	});

	it('refuses near-misses', () => {
		expect(isValidBtih('')).toBe(false);
		expect(isValidBtih(HASH.slice(0, 39))).toBe(false);
		expect(isValidBtih(`${HASH}a`)).toBe(false);
		// 32 chars, but 0/1/8/9 are outside the base32 alphabet
		expect(isValidBtih('01890189018901890189018901890189')).toBe(false);
		expect(isValidBtih(`${HASH.slice(0, 39)}z`)).toBe(false);
	});
});

describe('extractBtih / toMagnetUri', () => {
	it('pulls a lowercase hash out of a magnet', () => {
		expect(extractBtih(`magnet:?xt=urn:btih:${HASH.toUpperCase()}&dn=x`)).toBe(HASH);
	});

	it('returns null when the magnet carries no usable hash', () => {
		expect(extractBtih('magnet:?xt=urn:btih:zzzz')).toBeNull();
		expect(extractBtih('not a magnet')).toBeNull();
	});

	// A torrent-URL submission stores `<hash>.torrent` as its originalLink, not a
	// magnet - the only hash a library row built from one will ever have.
	it('recovers the hash from a torrent-file originalLink', () => {
		expect(extractBtih(`${HASH.toUpperCase()}.torrent`)).toBe(HASH);
		expect(extractBtih(`https://archive.org/download/x/${HASH}.torrent`)).toBe(HASH);
		expect(extractBtih(`https://example.com/${HASH}.torrent?token=abc`)).toBe(HASH);
	});

	it('does not invent a hash from an ordinary torrent filename', () => {
		expect(extractBtih('Some.Release.2024.1080p.torrent')).toBeNull();
		// 32 base32-legal characters are indistinguishable from a release name
		expect(extractBtih('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.torrent')).toBeNull();
		// 40 hex characters that are not the whole basename
		expect(extractBtih(`prefix${HASH}.torrent`)).toBeNull();
	});

	it('expands a bare hash and leaves a magnet alone', () => {
		expect(toMagnetUri(HASH)).toBe(MAGNET);
		expect(toMagnetUri(MAGNET)).toBe(MAGNET);
	});
});

describe('checkOffcloudCache', () => {
	// `/cache` replies with hits only, so "not cached" is a set difference and
	// never an absent per-item answer.
	it('builds results by set membership, not by position', async () => {
		fetchMock.mockResolvedValue(jsonResponse({ cachedItems: ['bbb'] }));

		const results = await checkOffcloudCache('key', ['aaa', 'bbb', 'ccc']);

		expect(results).toEqual([
			{ hash: 'aaa', cached: false },
			{ hash: 'bbb', cached: true },
			{ hash: 'ccc', cached: false },
		]);
		expect(lastBody()).toEqual({ hashes: ['aaa', 'bbb', 'ccc'] });
	});

	it('sends bare hashes, converting a magnet back down to one', async () => {
		fetchMock.mockResolvedValue(jsonResponse({ cachedItems: [HASH] }));

		const results = await checkOffcloudCache('key', [MAGNET]);

		expect(lastBody()).toEqual({ hashes: [HASH] });
		expect(results).toEqual([{ hash: HASH, cached: true }]);
	});

	it('matches case-insensitively - the key and the hashes both are', async () => {
		fetchMock.mockResolvedValue(jsonResponse({ cachedItems: [HASH.toUpperCase()] }));

		expect(await checkOffcloudCache('key', [HASH])).toEqual([{ hash: HASH, cached: true }]);
	});

	it('ignores hits for hashes that were not asked about', async () => {
		fetchMock.mockResolvedValue(jsonResponse({ cachedItems: ['aaa', 'unrelated'] }));

		const results = await checkOffcloudCache('key', ['aaa']);

		expect(results).toEqual([{ hash: 'aaa', cached: true }]);
	});

	it('reads a missing cachedItems array as "nothing cached"', async () => {
		fetchMock.mockResolvedValue(jsonResponse({}));

		expect(await checkOffcloudCache('key', ['aaa'])).toEqual([{ hash: 'aaa', cached: false }]);
	});

	it('chunks large batches', async () => {
		fetchMock.mockImplementation(async () => jsonResponse({ cachedItems: [] }));

		const hashes = Array.from({ length: CACHE_CHECK_CHUNK_SIZE + 5 }, (_, i) => `h${i}`);
		const results = await checkOffcloudCache('key', hashes);

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(results).toHaveLength(CACHE_CHECK_CHUNK_SIZE + 5);
	});

	it('makes no request for an empty list', async () => {
		expect(await checkOffcloudCache('key', [])).toEqual([]);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

describe('getOffcloudCacheInfo', () => {
	const listing = [
		{
			cached: true,
			files: [{ folder: 'BBB', filename: 'Big Buck Bunny.mp4', size: 276134947 }],
		},
	];

	// The trap: a bare hash here does not error, it answers `cached: false` for
	// content that is cached. Every input must go out in full magnet form.
	it('converts a bare hash into the magnet form the endpoint needs', async () => {
		fetchMock.mockResolvedValue(jsonResponse(listing));

		const results = await getOffcloudCacheInfo('key', [HASH]);

		expect(lastBody()).toEqual({ urls: [MAGNET], includeFiles: true });
		expect(results[0]).toEqual({
			source: MAGNET,
			cached: true,
			files: listing[0].files,
		});
	});

	it('passes a magnet through untouched', async () => {
		fetchMock.mockResolvedValue(jsonResponse(listing));

		await getOffcloudCacheInfo('key', [MAGNET]);

		expect(lastBody().urls).toEqual([MAGNET]);
	});

	it('refuses an input that is neither a magnet nor an info hash', async () => {
		await expect(
			getOffcloudCacheInfo('key', ['https://example.com/file.mkv'])
		).rejects.toMatchObject({ code: 'invalid_info_hash' });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('refuses a misaligned answer rather than mis-attributing it', async () => {
		fetchMock.mockResolvedValue(jsonResponse([{ cached: true, files: [] }]));

		await expect(getOffcloudCacheInfo('key', [HASH, 'a'.repeat(40)])).rejects.toMatchObject({
			code: 'misaligned_response',
		});
	});

	it('makes no request for an empty list', async () => {
		expect(await getOffcloudCacheInfo('key', [])).toEqual([]);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	// Measured live 2026-09-03: the wire form of `folder` is an **array of path
	// segments**, not the string every consumer was written against. Passed on
	// unconverted it reaches `offcloudFilePath`, whose `trimSlashes` throws
	// `TypeError: value.replace is not a function` - taking out the whole cast
	// surface, the library modal and the Offcloud watch intent.
	it('flattens the array of path segments the live endpoint sends as `folder`', async () => {
		fetchMock.mockResolvedValue(
			jsonResponse([
				{
					cached: true,
					files: [
						{ folder: ['Big Buck Bunny'], filename: 'poster.jpg', size: 310380 },
						{
							folder: ['Show.S01', 'Season 1'],
							filename: 'Show.S01E01.mkv',
							size: 500,
						},
					],
				},
			])
		);

		const [result] = await getOffcloudCacheInfo('key', [HASH]);

		expect(result.files).toEqual([
			{ folder: 'Big Buck Bunny', filename: 'poster.jpg', size: 310380 },
			{ folder: 'Show.S01/Season 1', filename: 'Show.S01E01.mkv', size: 500 },
		]);
	});

	it('keeps accepting a plain string folder, and defaults what it cannot read', async () => {
		fetchMock.mockResolvedValue(
			jsonResponse([
				{
					cached: true,
					files: [
						{ folder: 'BBB', filename: 'a.mkv', size: 5 },
						{ filename: 'b.mkv' },
						{ folder: [], filename: 'c.mkv', size: 1 },
					],
				},
			])
		);

		const [result] = await getOffcloudCacheInfo('key', [HASH]);

		expect(result.files).toEqual([
			{ folder: 'BBB', filename: 'a.mkv', size: 5 },
			{ folder: '', filename: 'b.mkv', size: 0 },
			{ folder: '', filename: 'c.mkv', size: 1 },
		]);
	});
});

describe('addOffcloudCloud', () => {
	it('reports a cached magnet as downloaded from the add response alone', async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({
				requestId: 'r1',
				fileName: 'Big Buck Bunny',
				status: 'downloaded',
				originalLink: `${MAGNET}&tr=udp%3A%2F%2Ftracker`,
			})
		);

		const added = await addOffcloudCloud('key', HASH);

		expect(lastCall()[0]).toBe('https://offcloud.com/api/cloud');
		expect(lastBody()).toEqual({ url: MAGNET });
		expect(added.status).toBe('downloaded');
	});

	it('refuses a garbage magnet before it can become a zombie', async () => {
		expect(() => addOffcloudCloud('key', 'magnet:?xt=urn:btih:zzzz')).toThrow(OffcloudError);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('passes a plain HTTP source through - it is a remote-download service too', async () => {
		fetchMock.mockResolvedValue(jsonResponse({ requestId: 'r2', status: 'created' }));

		await addOffcloudCloud('key', 'https://archive.org/x.torrent');

		expect(lastBody()).toEqual({ url: 'https://archive.org/x.torrent' });
	});
});

describe('cloud status, explore, history and removal', () => {
	it('polls one requestId per call - the plural form is rejected upstream', async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({
				status: {
					requestId: 'r1',
					status: 'downloaded',
					fileName: 'x',
					progress: null,
					message: null,
				},
			})
		);

		const status = await getOffcloudCloudStatus('key', 'r1');

		expect(lastBody()).toEqual({ requestId: 'r1' });
		expect(status.status).toBe('downloaded');
	});

	it('fails loudly when cloud/status carries no status object', async () => {
		fetchMock.mockResolvedValue(jsonResponse({}));

		await expect(getOffcloudCloudStatus('key', 'r1')).rejects.toMatchObject({
			code: 'no_status',
		});
	});

	it('returns explore as the bare array of links it is', async () => {
		fetchMock.mockResolvedValue(jsonResponse([`${CDN}/a.mkv`, `${CDN}/b.mkv`]));

		expect(await exploreOffcloudCloud('key', 'r1')).toHaveLength(2);
		expect(lastCall()[0]).toBe('https://offcloud.com/api/cloud/explore/r1');
	});

	it('refuses an explore answer that is not an array', async () => {
		fetchMock.mockResolvedValue(jsonResponse({ requestId: 'r1' }));

		await expect(exploreOffcloudCloud('key', 'r1')).rejects.toMatchObject({
			code: 'unexpected_response',
		});
	});

	it('tolerates a history answer that is not an array', async () => {
		fetchMock.mockResolvedValue(jsonResponse({}));
		expect(await getOffcloudHistory('key')).toEqual([]);
	});

	// Removal is a GET, which is why it must never be rendered as an href or
	// logged: anything that resolves URLs would delete the user's items.
	it('removes with a GET carrying no body', async () => {
		fetchMock.mockResolvedValue(jsonResponse({ success: true }));

		await removeOffcloudCloud('key', 'r1');

		const [url, init] = lastCall();
		expect(url).toBe('https://offcloud.com/api/cloud/remove/r1');
		expect(init.method).toBe('GET');
		expect(init.body).toBeUndefined();
	});
});

describe('joinExploreWithCacheInfo', () => {
	it('pairs links to files through the URL-encoded basename', () => {
		const joined = joinExploreWithCacheInfo(
			[`${CDN}/Big%20Buck%20Bunny.mp4`, `${CDN}/poster.jpg`],
			[
				{ folder: 'BBB', filename: 'poster.jpg', size: 310380 },
				{ folder: 'BBB', filename: 'Big Buck Bunny.mp4', size: 276134947 },
			]
		);

		expect(joined[0]).toEqual({
			link: `${CDN}/Big%20Buck%20Bunny.mp4`,
			filename: 'Big Buck Bunny.mp4',
			folder: 'BBB',
			size: 276134947,
		});
		expect(joined[1].size).toBe(310380);
	});

	it('hands duplicate filenames out one-for-one instead of all to the first', () => {
		const joined = joinExploreWithCacheInfo(
			[`${CDN}/ep.mkv`, `${CDN}/ep.mkv`],
			[
				{ folder: 'S01', filename: 'ep.mkv', size: 1 },
				{ folder: 'S02', filename: 'ep.mkv', size: 2 },
			]
		);

		expect(joined.map((f) => f.folder)).toEqual(['S01', 'S02']);
		expect(joined.map((f) => f.size)).toEqual([1, 2]);
	});

	it('still names a link cache/info knew nothing about', () => {
		const joined = joinExploreWithCacheInfo([`${CDN}/extra%20file.nfo`], []);

		expect(joined[0]).toEqual({
			link: `${CDN}/extra%20file.nfo`,
			filename: 'extra file.nfo',
			folder: null,
			size: null,
		});
	});
});

describe('isOffcloudPremium', () => {
	it('reads the only plan signal the API exposes', () => {
		expect(isOffcloudPremium({ is_premium: true })).toBe(true);
		expect(isOffcloudPremium({ is_premium: false })).toBe(false);
	});
});
