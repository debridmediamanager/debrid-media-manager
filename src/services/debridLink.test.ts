import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	DL_STATUS,
	DebridLinkError,
	FLOOD_LOCKOUT_MS,
	SEEDBOX_PAGE_SIZE,
	_testing,
	addSeedboxTorrent,
	debridLinkPremiumDaysLeft,
	deleteSeedboxTorrents,
	getDebridLinkAccountInfo,
	getSeedboxActivity,
	getSeedboxLimits,
	getSeedboxTorrent,
	isDebridLinkPremium,
	isDlFinished,
	listAllSeedboxTorrents,
	listSeedboxTorrents,
	toMagnetUri,
	zipSeedboxTorrent,
} from './debridLink';

const HASH = 'ed466e1992373789d7e7146ba264746359b52d09';
const TOKEN = 'dl-test-token';

const torrent = (over: Record<string, unknown> = {}) => ({
	id: '2115ca3cf4356d24510',
	name: 'The name of torrent',
	created: 1788380105,
	hashString: HASH,
	uploadRatio: 1.42,
	serverId: 'seed20',
	wait: false,
	peersConnected: 0,
	status: 100,
	totalSize: 2556175746,
	downloadPercent: 100,
	downloadSpeed: 0,
	uploadSpeed: 0,
	isZip: false,
	srvMaint: false,
	files: [
		{
			id: '2115ca3cf4356d24510-1',
			name: 'The.file.name.ext',
			size: 1278087873,
			downloadUrl: 'https://seed20.debrid.link/dl/2115ca3cf4356d24510-1/The.file.name.ext',
			downloadPercent: 100,
		},
	],
	...over,
});

const jsonResponse = (body: unknown, status = 200) =>
	({
		ok: status >= 200 && status < 300,
		status,
		headers: { get: (name: string) => (name === 'content-type' ? 'application/json' : null) },
		json: async () => body,
	}) as unknown as Response;

/**
 * The doc-site Angular shell is served with a 200 for unauthenticated paths on
 * this host, so this is what a routing mistake looks like from the client.
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

const ok = (value: unknown, pagination?: unknown) =>
	jsonResponse(
		pagination === undefined ? { success: true, value } : { success: true, value, pagination }
	);

const fetchMock = vi.fn();
const lastCall = () => fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
const lastUrl = () => String(lastCall()[0]);
const lastBody = () => Object.fromEntries(new URLSearchParams(lastCall()[1].body));

beforeEach(() => {
	fetchMock.mockReset();
	vi.stubGlobal('fetch', fetchMock);
	_testing.resetFloodLockouts();
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe('debrid-link transport', () => {
	it('builds every URL under the versioned base', async () => {
		fetchMock.mockResolvedValue(ok([]));

		await getDebridLinkAccountInfo(TOKEN);
		await listSeedboxTorrents(TOKEN);
		await getSeedboxActivity(TOKEN);
		await getSeedboxLimits(TOKEN);
		await deleteSeedboxTorrents(TOKEN, ['abc']);
		fetchMock.mockResolvedValue(ok(torrent()));
		await addSeedboxTorrent(TOKEN, HASH);
		fetchMock.mockResolvedValue(ok({ status: 'ready' }));
		await zipSeedboxTorrent(TOKEN, 'abc', ['abc-1']);

		expect(fetchMock.mock.calls.length).toBeGreaterThan(5);
		for (const [url] of fetchMock.mock.calls) {
			// Dropping `/v2` does not 404 - it reaches a different API whose
			// envelope carries no `success` field at all, which this client
			// would read as a failure on every call.
			expect(String(url).startsWith('https://debrid-link.fr/api/v2/')).toBe(true);
		}
	});

	it('sends the token in a header and never in the query string', async () => {
		fetchMock.mockResolvedValue(ok({ username: 'ymsita', accountType: 1 }));

		await getDebridLinkAccountInfo(TOKEN);

		const [url, init] = lastCall();
		expect(url).toBe('https://debrid-link.fr/api/v2/account/infos');
		// `?access_token=` authenticates upstream and is a log-leak path.
		expect(String(url)).not.toContain(TOKEN);
		expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
		expect(init.method).toBe('GET');
	});

	it('rejects a missing token without touching the network', async () => {
		await expect(getDebridLinkAccountInfo('')).rejects.toMatchObject({
			code: 'authentication_failed',
		});
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('maps a 401 badToken to its own code', async () => {
		fetchMock.mockResolvedValue(
			jsonResponse(
				{
					success: false,
					error: 'badToken',
					error_description: 'The session not exist or expired.',
				},
				401
			)
		);

		const failure = await getDebridLinkAccountInfo('revoked').catch((e) => e);

		expect(failure).toBeInstanceOf(DebridLinkError);
		expect(failure.code).toBe('badToken');
		expect(failure.message).toContain('expired');
	});

	it('falls back to badToken on a bare 401 with no error string', async () => {
		fetchMock.mockResolvedValue(jsonResponse({ success: false }, 401));

		await expect(getDebridLinkAccountInfo('revoked')).rejects.toMatchObject({
			code: 'badToken',
		});
	});

	it('treats success:false as a failure even under a 200', async () => {
		fetchMock.mockResolvedValue(jsonResponse({ success: false, error: 'badArguments' }, 200));

		await expect(listSeedboxTorrents(TOKEN)).rejects.toMatchObject({ code: 'badArguments' });
	});

	it('carries the undocumented error_id correlation stamp', async () => {
		fetchMock.mockResolvedValue(
			jsonResponse(
				{
					success: false,
					error: 'badTorrentFile',
					error_id: '#6A9884A7BBAF73337358946464',
				},
				400
			)
		);

		const failure = await addSeedboxTorrent(TOKEN, 'magnet:?xt=urn:btih:nope').catch((e) => e);

		expect(failure.code).toBe('badTorrentFile');
		expect(failure.errorId).toBe('#6A9884A7BBAF73337358946464');
	});

	it('reports an HTML body under a 200 rather than throwing on the parse', async () => {
		fetchMock.mockResolvedValue(htmlResponse(200));

		const failure = await getDebridLinkAccountInfo(TOKEN).catch((e) => e);

		expect(failure).toBeInstanceOf(DebridLinkError);
		expect(failure.code).toBe('non_json_response');
		expect(failure.message).toContain('text/html');
	});
});

describe('flood lockout', () => {
	const flood = () =>
		jsonResponse(
			{
				success: false,
				error: 'floodDetected',
				error_description: 'API rate limit reached for the endpoint, retry after 1 hour',
			},
			429
		);

	it('short-circuits the endpoint for an hour after one floodDetected', async () => {
		fetchMock.mockResolvedValue(flood());

		await expect(getSeedboxLimits(TOKEN)).rejects.toMatchObject({ code: 'floodDetected' });
		expect(fetchMock).toHaveBeenCalledTimes(1);

		// The vendor would refuse this anyway for the next hour; spending a
		// round trip to be told so is the whole thing being avoided.
		const second = await getSeedboxLimits(TOKEN).catch((e) => e);
		expect(second).toBeInstanceOf(DebridLinkError);
		expect(second.code).toBe('floodDetected');
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('reports how much of the lockout is left', async () => {
		fetchMock.mockResolvedValue(flood());
		await getSeedboxLimits(TOKEN).catch(() => undefined);

		const failure = await getSeedboxLimits(TOKEN).catch((e) => e);

		expect(failure.retryAfterMs).toBeGreaterThan(FLOOD_LOCKOUT_MS - 5_000);
		expect(failure.retryAfterMs).toBeLessThanOrEqual(FLOOD_LOCKOUT_MS);
		expect(failure.message).toMatch(/minute/);
	});

	// The lockout is per endpoint, so one throttled poll must not take the whole
	// provider down with it.
	it('locks only the endpoint that flooded', async () => {
		fetchMock.mockResolvedValueOnce(flood()).mockResolvedValue(ok({ username: 'ymsita' }));

		await getSeedboxLimits(TOKEN).catch(() => undefined);
		await expect(getDebridLinkAccountInfo(TOKEN)).resolves.toMatchObject({
			username: 'ymsita',
		});
	});

	// One route template, many concrete paths: deleting torrent A and torrent B
	// are the same endpoint as far as the ban is concerned.
	it('keys the lockout on the route, not the concrete path', async () => {
		fetchMock.mockResolvedValue(flood());

		await deleteSeedboxTorrents(TOKEN, ['aaa']).catch(() => undefined);
		await expect(deleteSeedboxTorrents(TOKEN, ['bbb'])).rejects.toMatchObject({
			code: 'floodDetected',
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('resumes once the hour is up', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-09-03T00:00:00Z'));
		fetchMock.mockResolvedValueOnce(flood());

		await getSeedboxLimits(TOKEN).catch(() => undefined);
		vi.setSystemTime(new Date('2026-09-03T01:00:01Z'));
		fetchMock.mockResolvedValue(ok({ dayCount: { current: 3, value: 50 } }));

		await expect(getSeedboxLimits(TOKEN)).resolves.toEqual({
			dayCount: { current: 3, value: 50 },
		});
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});
});

describe('account info', () => {
	it('reads the plan off accountType, which is 0 free / 1 premium', () => {
		expect(isDebridLinkPremium({ accountType: 1 })).toBe(true);
		expect(isDebridLinkPremium({ accountType: 0 })).toBe(false);
	});

	it('turns premiumLeft seconds into days - it is not a timestamp', () => {
		expect(debridLinkPremiumDaysLeft({ premiumLeft: 3628800 })).toBe(42);
		expect(debridLinkPremiumDaysLeft({ premiumLeft: 86_399 })).toBe(0);
		expect(debridLinkPremiumDaysLeft({ premiumLeft: 0 })).toBe(0);
		expect(debridLinkPremiumDaysLeft({ premiumLeft: -1 })).toBe(0);
	});
});

describe('isDlFinished', () => {
	// The trap: `status` combines flags, so an equality test against any single
	// state is wrong. The vendor's own sample carries 6 = VERIFICATION|DOWNLOADING.
	it('is a threshold, not an equality test', () => {
		expect(isDlFinished(6)).toBe(false);
		expect(isDlFinished(DL_STATUS.FINISHED)).toBe(true);
		expect(isDlFinished(101)).toBe(true);
	});

	it('calls none of the flag states finished', () => {
		expect(isDlFinished(DL_STATUS.PAUSED)).toBe(false);
		expect(isDlFinished(DL_STATUS.QUEUED)).toBe(false);
		expect(isDlFinished(DL_STATUS.VERIFICATION)).toBe(false);
		expect(isDlFinished(DL_STATUS.DOWNLOADING)).toBe(false);
		// Seeding is a live torrent, not a finished one, and 8 !== 100 either way.
		expect(isDlFinished(DL_STATUS.SEEDING)).toBe(false);
	});
});

describe('toMagnetUri', () => {
	it('expands a bare hash and leaves a magnet alone', () => {
		expect(toMagnetUri(HASH)).toBe(`magnet:?xt=urn:btih:${HASH}`);
		expect(toMagnetUri(`magnet:?xt=urn:btih:${HASH}&dn=x`)).toBe(
			`magnet:?xt=urn:btih:${HASH}&dn=x`
		);
	});
});

describe('listSeedboxTorrents', () => {
	it('asks for the documented maximum page size', async () => {
		fetchMock.mockResolvedValue(ok([torrent()], { page: 0, pages: 1, next: -1, previous: -1 }));

		await listSeedboxTorrents(TOKEN);

		expect(lastUrl()).toContain(`perPage=${SEEDBOX_PAGE_SIZE}`);
		expect(lastUrl()).not.toContain('ids=');
	});

	// THE trap. An id Debrid-Link does not recognise makes the filter vanish and
	// the whole account come back; a caller that deletes or reconciles against
	// that result wipes the library.
	it('post-filters an ids query against what was asked for', async () => {
		fetchMock.mockResolvedValue(
			ok([
				torrent({ id: 'wanted' }),
				torrent({ id: 'someone-elses-torrent' }),
				torrent({ id: 'another-one' }),
			])
		);

		const { torrents } = await listSeedboxTorrents(TOKEN, { ids: ['wanted'] });

		expect(torrents.map((t) => t.id)).toEqual(['wanted']);
		expect(lastUrl()).toContain('ids=wanted');
	});

	it('returns nothing when a filtered read matches nothing, whole list or not', async () => {
		fetchMock.mockResolvedValue(ok([torrent({ id: 'a' }), torrent({ id: 'b' })]));

		const { torrents } = await listSeedboxTorrents(TOKEN, { ids: ['notarealid'] });

		expect(torrents).toEqual([]);
	});

	it('never turns an empty filter into an unfiltered fetch', async () => {
		const { torrents } = await listSeedboxTorrents(TOKEN, { ids: [] });

		expect(torrents).toEqual([]);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	// The endpoint's description spells the ZIP-expanding parameter `id` while
	// its parameter table lists only `ids`. Both go out; the client-side match
	// makes it safe whichever one the server honours.
	it('sends both spellings for a single-id read', async () => {
		fetchMock.mockResolvedValue(ok([torrent({ id: 'solo' })]));

		await listSeedboxTorrents(TOKEN, { ids: ['solo'] });

		expect(lastUrl()).toContain('ids=solo');
		expect(lastUrl()).toContain('id=solo');
	});

	it('tolerates a value that is not an array', async () => {
		fetchMock.mockResolvedValue(ok(null));

		await expect(listSeedboxTorrents(TOKEN)).resolves.toMatchObject({ torrents: [] });
	});
});

describe('listAllSeedboxTorrents', () => {
	it('stops on the documented next === -1 terminator', async () => {
		fetchMock.mockResolvedValue(
			ok([torrent({ id: 'only' })], { page: 0, pages: 1, next: -1, previous: -1 })
		);

		const all = await listAllSeedboxTorrents(TOKEN);

		expect(all.map((t) => t.id)).toEqual(['only']);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('follows the cursor across pages', async () => {
		fetchMock
			.mockResolvedValueOnce(
				ok([torrent({ id: 'a' })], { page: 0, pages: 2, next: 1, previous: -1 })
			)
			.mockResolvedValueOnce(
				ok([torrent({ id: 'b' })], { page: 1, pages: 2, next: -1, previous: 0 })
			);

		const all = await listAllSeedboxTorrents(TOKEN);

		expect(all.map((t) => t.id)).toEqual(['a', 'b']);
		expect(fetchMock.mock.calls[1][0]).toContain('page=1');
	});

	// A cursor that does not advance would otherwise loop forever - and the
	// punishment for a request loop here is an hour without the endpoint.
	it('stops rather than spinning when the cursor stands still', async () => {
		fetchMock.mockResolvedValue(
			ok([torrent({ id: 'a' })], { page: 0, pages: 9, next: 0, previous: -1 })
		);

		const all = await listAllSeedboxTorrents(TOKEN);

		expect(all).toHaveLength(1);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('stops when the answer carries no pagination at all', async () => {
		fetchMock.mockResolvedValue(ok([torrent()]));

		await listAllSeedboxTorrents(TOKEN);

		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});

describe('getSeedboxTorrent', () => {
	it('expands a zipped torrent by fetching it on its own', async () => {
		fetchMock.mockResolvedValue(
			ok([
				torrent({
					id: 'zipped',
					isZip: false,
					files: [
						{
							id: 'zipped-1',
							name: 'S01E01.mkv',
							size: 1,
							downloadUrl: 'https://seed41.debrid.link/dl/zipped-1/S01E01.mkv',
							downloadPercent: 100,
						},
						{
							id: 'zipped-2',
							name: 'S01E02.mkv',
							size: 2,
							downloadUrl: 'https://seed41.debrid.link/dl/zipped-2/S01E02.mkv',
							downloadPercent: 100,
						},
					],
				}),
			])
		);

		const expanded = await getSeedboxTorrent(TOKEN, 'zipped');

		expect(expanded?.files).toHaveLength(2);
	});

	// An unknown id is not an error here, it is the entire account coming back -
	// which the client-side match reduces to nothing.
	it('answers null for an unknown id even when the whole account comes back', async () => {
		fetchMock.mockResolvedValue(ok([torrent({ id: 'a' }), torrent({ id: 'b' })]));

		await expect(getSeedboxTorrent(TOKEN, 'gone')).resolves.toBeNull();
	});
});

describe('addSeedboxTorrent', () => {
	it('posts the source as a form field', async () => {
		fetchMock.mockResolvedValue(ok(torrent()));

		const added = await addSeedboxTorrent(TOKEN, `magnet:?xt=urn:btih:${HASH}`);

		const [url, init] = lastCall();
		expect(url).toBe('https://debrid-link.fr/api/v2/seedbox/add');
		expect(init.method).toBe('POST');
		expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
		expect(lastBody()).toEqual({ url: `magnet:?xt=urn:btih:${HASH}` });
		// A cached source answers synchronously complete, so the add response
		// alone says whether it is playable now.
		expect(isDlFinished(added.status)).toBe(true);
	});

	it('sends a bare hash unchanged - that form is the cache probe', async () => {
		fetchMock.mockResolvedValue(ok(torrent()));

		await addSeedboxTorrent(TOKEN, ` ${HASH} `);

		expect(lastBody()).toEqual({ url: HASH });
	});

	it('passes the file-selection and structure options through', async () => {
		fetchMock.mockResolvedValue(ok(torrent()));

		await addSeedboxTorrent(TOKEN, HASH, { wait: true, structureType: 'tree' });

		expect(lastBody()).toEqual({ url: HASH, wait: 'true', structureType: 'tree' });
	});

	it('refuses an empty source without a request', async () => {
		await expect(addSeedboxTorrent(TOKEN, '   ')).rejects.toMatchObject({
			code: 'badArguments',
		});
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('surfaces the uncached bare-hash refusal as its own code', async () => {
		fetchMock.mockResolvedValue(jsonResponse({ success: false, error: 'notAddTorrent' }, 400));

		await expect(addSeedboxTorrent(TOKEN, HASH)).rejects.toMatchObject({
			code: 'notAddTorrent',
		});
	});
});

describe('getSeedboxActivity', () => {
	it('returns the activity map keyed by torrent id', async () => {
		fetchMock.mockResolvedValue(
			ok({ abc: { status: 100, downloadPercent: 100, files: [100, 100] } })
		);

		const activity = await getSeedboxActivity(TOKEN);

		expect(activity.abc.files).toEqual([100, 100]);
	});

	// Same filter trap as the list: an unrecognised id brings the whole account
	// back, so the answer is matched before anything acts on it.
	it('post-filters an ids query the same way the list does', async () => {
		fetchMock.mockResolvedValue(
			ok({
				wanted: { status: 4, downloadPercent: 12, files: [12] },
				stranger: { status: 100, downloadPercent: 100, files: [100] },
			})
		);

		const activity = await getSeedboxActivity(TOKEN, ['wanted']);

		expect(Object.keys(activity)).toEqual(['wanted']);
	});

	it('never turns an empty filter into an unfiltered fetch', async () => {
		await expect(getSeedboxActivity(TOKEN, [])).resolves.toEqual({});
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

describe('deleteSeedboxTorrents', () => {
	it('batches ids into the path with a DELETE', async () => {
		fetchMock.mockResolvedValue(ok(['a', 'b']));

		const attempted = await deleteSeedboxTorrents(TOKEN, ['a', 'b']);

		const [url, init] = lastCall();
		expect(url).toBe('https://debrid-link.fr/api/v2/seedbox/a,b/remove');
		expect(init.method).toBe('DELETE');
		expect(attempted).toEqual(['a', 'b']);
	});

	// Removal never fails: a nonexistent id comes back success:true with the id
	// echoed. The return value is "attempted", never "existed".
	it('reports a nonexistent id as attempted rather than as an error', async () => {
		fetchMock.mockResolvedValue(ok(['garbage']));

		await expect(deleteSeedboxTorrents(TOKEN, ['garbage'])).resolves.toEqual(['garbage']);
	});

	it('makes no request for an empty id list', async () => {
		await expect(deleteSeedboxTorrents(TOKEN, ['', '  '])).resolves.toEqual([]);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

describe('zipSeedboxTorrent', () => {
	it('posts the chosen file ids and returns the keyless zip url', async () => {
		fetchMock.mockResolvedValue(
			ok({ status: 'ready', url: 'https://seed41.debrid.link/zip/z1/Name.zip' })
		);

		const zip = await zipSeedboxTorrent(TOKEN, 'abc', ['abc-1', 'abc-2']);

		expect(lastUrl()).toBe('https://debrid-link.fr/api/v2/seedbox/abc/zip');
		expect(lastBody()).toEqual({ ids: 'abc-1,abc-2' });
		expect(zip.url).toContain('/zip/');
	});

	it('refuses a zip of nothing without a request', async () => {
		await expect(zipSeedboxTorrent(TOKEN, 'abc', [])).rejects.toMatchObject({
			code: 'badArguments',
		});
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

describe('getSeedboxLimits', () => {
	it('returns the {current, value} quota map', async () => {
		fetchMock.mockResolvedValue(
			ok({
				dayCount: { current: 3, value: 50 },
				nextResetSeconds: { current: -1, value: 85942 },
			})
		);

		const limits = await getSeedboxLimits(TOKEN);

		expect(limits.dayCount).toEqual({ current: 3, value: 50 });
	});

	it('tolerates a value that is not an object', async () => {
		fetchMock.mockResolvedValue(ok(null));

		await expect(getSeedboxLimits(TOKEN)).resolves.toEqual({});
	});
});
