import historyHandler from '@/pages/api/sponsor/wanted/history';
import nzbHandler from '@/pages/api/sponsor/wanted/nzb/[sha]';
import siteHistoryHandler from '@/pages/api/wanted/history';
import { _resetTokenSecretForTest, encryptReleaseId } from '@/services/newznab/opaqueId';
import { putStoredNzb } from '@/services/newznab/store';
import { checkRateLimitFor, RATE_LIMIT_CONFIGS } from '@/services/rateLimit/withRateLimit';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { requireSponsor } from '@/utils/requireSponsor';
import type { NextApiRequest } from 'next';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');
vi.mock('@/utils/requireSponsor', () => ({ requireSponsor: vi.fn() }));
vi.mock('@/services/newznab/store', () => ({
	isStoreConfigured: vi.fn(() => true),
	putStoredNzb: vi.fn(),
}));
vi.mock('@/services/rateLimit/withRateLimit', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/services/rateLimit/withRateLimit')>()),
	checkRateLimitFor: vi.fn(),
}));

const mockRepository = vi.mocked(repository);
const sponsorKey = 'c'.repeat(64);
const ACTIVE = {
	isSponsor: true,
	sources: ['github' as const],
	shortId: 'ZP1M',
	githubUsername: 'someone',
	keyVersion: 1,
};
const ID = '0b7c2f8e-1d1f-4a55-9c3a-6c9d8e7f1a2b';
const OTHER = '5d1e2f8e-1d1f-4a55-9c3a-6c9d8e7f1a2b';
const SHA = 'a'.repeat(64);
const HASH = 'b'.repeat(40);

const grabbed = (over: Record<string, unknown> = {}) => ({
	key: 'grab:1',
	at: '2026-11-19T13:29:00Z',
	kind: 'grabbed',
	release: 'Show.S01E07.1080p.WEB.h264-GRP',
	torrent: false,
	hash: '',
	nzb: SHA,
	size: 1234567890,
	posted: '2026-11-18T00:00:00Z',
	season: 1,
	episode: 7,
	pack: false,
	resolution: '1080p',
	...over,
});

beforeEach(() => {
	process.env.NEWZNAB_TOKEN_SECRET = 'ab'.repeat(32);
	_resetTokenSecretForTest();
	mockRepository.getSponsorByDmmApiKey = vi.fn().mockResolvedValue(ACTIVE);
	mockRepository.ownedWanted = vi
		.fn()
		.mockResolvedValue(new Map([[ID, { imdbId: 'tt0115082', kind: 'show' }]]));
	mockRepository.recordWantedEvents = vi.fn(async (_s, _o, events) => events.length);
	mockRepository.setWantedProgress = vi.fn().mockResolvedValue(undefined);
	mockRepository.heldWantedNzbs = vi.fn().mockResolvedValue(new Set());
	mockRepository.reportedWantedNzb = vi.fn().mockResolvedValue(true);
	mockRepository.markWantedNzbHeld = vi.fn().mockResolvedValue(undefined);
	vi.mocked(checkRateLimitFor).mockResolvedValue(true);
	vi.mocked(putStoredNzb).mockResolvedValue(true);
});
afterEach(() => {
	vi.clearAllMocks();
	delete process.env.NEWZNAB_TOKEN_SECRET;
	_resetTokenSecretForTest();
});

describe('POST /api/sponsor/wanted/history', () => {
	const post = async (
		body: unknown,
		headers: Record<string, string> = { 'x-api-key': sponsorKey }
	) => {
		const res = createMockResponse();
		await historyHandler(createMockRequest({ method: 'POST', headers, body }), res);
		return res;
	};
	const one = (event: Record<string, unknown>) => ({ items: [{ id: ID, events: [event] }] });

	it('stores what zurg reports and says which NZBs it wants', async () => {
		const res = await post({
			items: [
				{
					id: ID,
					seasons: [{ season: 1, have: [3, 1, 2, 2], missing: [7] }],
					events: [
						grabbed(),
						{
							key: 'rej:1',
							at: '2026-11-19T13:00:00Z',
							kind: 'rejected',
							reason: 'quality',
							detail: 'below 1080p',
							release: 'Show.S01E07.480p.WEB-GRP',
							torrent: true,
							hash: HASH,
						},
						{
							key: 'fail:1',
							at: '2026-11-19T12:00:00Z',
							kind: 'failed',
							reason: 'nothing_passed',
							detail: '12 passed over: 7 quality, 5 language',
						},
					],
				},
				{ id: OTHER, events: [grabbed({ nzb: 'c'.repeat(64) })] },
			],
		});

		expect(res._getStatusCode()).toBe(200);
		expect(res._getData()).toEqual({ ok: true, stored: 3, unknown: [OTHER], want_nzb: [SHA] });
		expect(checkRateLimitFor).toHaveBeenCalledWith(
			'sponsor:ZP1M',
			RATE_LIMIT_CONFIGS.sponsorWantedHistory,
			res
		);
		expect(mockRepository.ownedWanted).toHaveBeenCalledWith('ZP1M', [ID, OTHER]);
		const [shortId, , events] = mockRepository.recordWantedEvents.mock.calls[0];
		expect(shortId).toBe('ZP1M');
		// Only the known item's events, and nothing of the unknown one.
		expect(events.map((e) => [e.itemId, e.key])).toEqual([
			[ID, 'grab:1'],
			[ID, 'rej:1'],
			[ID, 'fail:1'],
		]);
		expect(events[0]).toMatchObject({
			kind: 'grabbed',
			reason: '',
			nzb: SHA,
			hash: null,
			dmmId: null,
			size: 1234567890,
			at: new Date('2026-11-19T13:29:00Z'),
			posted: new Date('2026-11-18T00:00:00Z'),
		});
		expect(events[1]).toMatchObject({ torrent: true, hash: HASH, nzb: null });
		expect(mockRepository.setWantedProgress).toHaveBeenCalledWith('ZP1M', ID, [
			{ season: 1, have: [1, 2, 3], missing: [7] },
		]);
	});

	it('wants no NZB that DMM served, holds already, came as a torrent or was not grabbed', async () => {
		const held = 'd'.repeat(64);
		mockRepository.heldWantedNzbs = vi.fn().mockResolvedValue(new Set([held]));
		const res = await post({
			items: [
				{
					id: ID,
					events: [
						grabbed({ key: 'a', dmm_id: encryptReleaseId('ds', 'native-1') }),
						grabbed({ key: 'b', nzb: held }),
						grabbed({ key: 'c', torrent: true, nzb: '', hash: HASH }),
						grabbed({
							key: 'd',
							kind: 'rejected',
							reason: 'sample',
							nzb: 'e'.repeat(64),
						}),
						grabbed({ key: 'e', nzb: 'f'.repeat(64) }),
						grabbed({ key: 'f', nzb: 'f'.repeat(64) }),
					],
				},
			],
		});
		expect(res._getData()).toMatchObject({ want_nzb: ['f'.repeat(64)] });
		const events = mockRepository.recordWantedEvents.mock.calls[0][2];
		// The token is stored as the release it names, never as sent.
		expect(events[0].dmmId).toBe('ds:native-1');
	});

	it('takes an NZB another zurg uploaded as that upload, which DMM holds', async () => {
		mockRepository.heldWantedNzbs = vi.fn().mockResolvedValue(new Set([SHA]));
		const res = await post(
			one(grabbed({ nzb: 'e'.repeat(64), dmm_id: encryptReleaseId('wanted', SHA) }))
		);
		expect(res._getData()).toMatchObject({ want_nzb: [] });
		expect(mockRepository.recordWantedEvents.mock.calls[0][2][0]).toMatchObject({
			nzb: SHA,
			dmmId: null,
		});
	});

	it('reads a token it cannot open as an NZB from elsewhere', async () => {
		const res = await post(
			one(grabbed({ dmm_id: 'bm90LWEtdG9rZW4tbm90LWEtdG9rZW4tbm90LWEtdG9rZW4' }))
		);
		expect(res._getData()).toMatchObject({ stored: 1, want_nzb: [SHA] });
	});

	it('asks for no NZB while it cannot store one', async () => {
		delete process.env.NEWZNAB_TOKEN_SECRET;
		_resetTokenSecretForTest();
		expect((await post(one(grabbed())))._getData()).toMatchObject({ want_nzb: [] });
	});

	it('leaves a film without a snapshot', async () => {
		mockRepository.ownedWanted = vi
			.fn()
			.mockResolvedValue(new Map([[ID, { imdbId: 'tt0133093', kind: 'movie' }]]));
		await post({ items: [{ id: ID, seasons: [{ season: 1, have: [1], missing: [] }] }] });
		expect(mockRepository.setWantedProgress).not.toHaveBeenCalled();
	});

	it.each([
		['no items', {}],
		[
			'21 items',
			{
				items: Array.from({ length: 21 }, (_, i) => ({
					id: ID.slice(0, -2) + String(i).padStart(2, '0'),
				})),
			},
		],
		['an item twice', { items: [{ id: ID }, { id: ID.toUpperCase() }] }],
		['a bad item id', { items: [{ id: 'nope' }] }],
		[
			'201 events',
			{
				items: [
					{
						id: ID,
						events: Array.from({ length: 201 }, (_, i) => grabbed({ key: `k${i}` })),
					},
				],
			},
		],
	])('refuses %s and stores nothing', async (_what, body) => {
		const res = await post(body);
		expect(res._getStatusCode()).toBe(400);
		expect(mockRepository.recordWantedEvents).not.toHaveBeenCalled();
		expect(mockRepository.setWantedProgress).not.toHaveBeenCalled();
	});

	// One event zurg got wrong must not cost the report it came in: zurg marks a
	// report sent whatever DMM made of it, so a 400 here lost up to 200 events.
	it('stores the rest of a report holding one bad event, and names the bad one', async () => {
		const res = await post({
			items: [{ id: ID, events: [grabbed(), grabbed({ key: 'grab:2', resolution: '4k' })] }],
		});
		expect(res._getStatusCode()).toBe(200);
		const [, , events] = mockRepository.recordWantedEvents.mock.calls[0];
		expect(events.map((e: { key: string }) => e.key)).toEqual(['grab:1']);
		expect((res._getData() as { refused: string[] }).refused).toEqual([
			expect.stringMatching(/^items\[0\]\.events\[1\]: "resolution"/),
		]);
	});

	it.each([
		['a key outside the alphabet', one(grabbed({ key: 'a b' }))],
		['a 65-character key', one(grabbed({ key: 'k'.repeat(65) }))],
		['no key', one(grabbed({ key: undefined }))],
		['a bad time', one(grabbed({ at: 'yesterday' }))],
		['an unknown kind', one(grabbed({ kind: 'stolen' }))],
		['a reason on a grab', one(grabbed({ reason: 'quality' }))],
		['a rejection without a reason', one(grabbed({ kind: 'rejected' }))],
		['a failure with a release reason', one(grabbed({ kind: 'failed', reason: 'quality' }))],
		[
			'a rejection with a failure reason',
			one(grabbed({ kind: 'rejected', reason: 'nothing_found' })),
		],
		['an unknown reason', one(grabbed({ kind: 'rejected', reason: 'bad_vibes' }))],
		['a 301-character detail', one(grabbed({ detail: 'd'.repeat(301) }))],
		['a 513-character release', one(grabbed({ release: 'r'.repeat(513) }))],
		['a grab without a release', one(grabbed({ release: '' }))],
		[
			'an URL in detail',
			one(
				grabbed({
					kind: 'rejected',
					reason: 'fetch_failed',
					detail: 'GET https://indexer.example/api failed',
				})
			),
		],
		[
			'an API key in detail',
			one(
				grabbed({
					kind: 'rejected',
					reason: 'fetch_failed',
					detail: 'api?t=get&APIKEY=abc',
				})
			),
		],
		['an URL in release', one(grabbed({ release: 'ftp://host/Show.S01E07' }))],
		['a control character in release', one(grabbed({ release: 'Show\u0000.S01E07' }))],
		['an uppercase hash', one(grabbed({ torrent: true, nzb: '', hash: 'B'.repeat(40) }))],
		['a short hash', one(grabbed({ torrent: true, nzb: '', hash: 'b'.repeat(39) }))],
		['a short sha256', one(grabbed({ nzb: 'a'.repeat(63) }))],
		['an uppercase sha256', one(grabbed({ nzb: 'A'.repeat(64) }))],
		['a torrent with an NZB', one(grabbed({ torrent: true, hash: HASH }))],
		['an NZB with a hash', one(grabbed({ hash: HASH }))],
		['a dmm_id that is no token', one(grabbed({ dmm_id: 'ds:native-1' }))],
		['a torrent that is not a boolean', one(grabbed({ torrent: 'yes' }))],
		['an unknown resolution', one(grabbed({ resolution: '4k' }))],
		['a negative size', one(grabbed({ size: -1 }))],
		['a fractional season', one(grabbed({ season: 1.5 }))],
		['a bad posted time', one(grabbed({ posted: 'soon' }))],
		['an event that is not an object', one('grabbed' as never)],
		['seasons that are not a list', { items: [{ id: ID, seasons: { 1: [1] } }] }],
		['a season twice', { items: [{ id: ID, seasons: [{ season: 1 }, { season: 1 }] }] }],
		[
			'episodes that are not numbers',
			{ items: [{ id: ID, seasons: [{ season: 1, have: ['1'] }] }] },
		],
		[
			'2001 episodes',
			{
				items: [
					{
						id: ID,
						seasons: [{ season: 1, have: Array.from({ length: 2001 }, (_, i) => i) }],
					},
				],
			},
		],
	])('leaves out %s, says so, and stores nothing of it', async (_what, body) => {
		const res = await post(body);
		expect(res._getStatusCode()).toBe(200);
		expect((res._getData() as { refused: string[] }).refused).toHaveLength(1);
		expect(mockRepository.recordWantedEvents.mock.calls[0][2]).toEqual([]);
		expect(mockRepository.setWantedProgress).not.toHaveBeenCalled();
	});

	it('answers 401 without a key, 429 over its own budget and 405 for a GET', async () => {
		expect((await post(one(grabbed()), {}))._getStatusCode()).toBe(401);
		vi.mocked(checkRateLimitFor).mockResolvedValue(false);
		expect((await post(one(grabbed())))._getStatusCode()).toBe(429);
		const res = createMockResponse();
		await historyHandler(createMockRequest({ method: 'GET' }), res);
		expect(res._getStatusCode()).toBe(405);
	});
});

describe('PUT /api/sponsor/wanted/nzb/<sha>', () => {
	const PLAIN = readFileSync(path.resolve(__dirname, '../../fixtures/wantedNzb/plain.nzb'));
	const HOSTILE = readFileSync(path.resolve(__dirname, '../../fixtures/wantedNzb/hostile.nzb'));
	const shaOf = (body: Buffer) => createHash('sha256').update(body).digest('hex');

	const put = async (sha: string, body: Buffer, headers: Record<string, string> = {}) => {
		const req = Object.assign(Readable.from([body]), {
			method: 'PUT',
			query: { sha },
			headers: { 'x-api-key': sponsorKey, 'content-length': String(body.length), ...headers },
		}) as unknown as NextApiRequest;
		const res = createMockResponse();
		await nzbHandler(req, res);
		return res;
	};

	it('stores the rebuilt NZB under the sha it was uploaded as, with nothing of the uploader', async () => {
		const res = await put(shaOf(HOSTILE), HOSTILE);

		expect(res._getStatusCode()).toBe(200);
		expect(res._getData()).toEqual({ ok: true });
		expect(mockRepository.reportedWantedNzb).toHaveBeenCalledWith('ZP1M', shaOf(HOSTILE));
		const [prefix, id, xml] = vi.mocked(putStoredNzb).mock.calls[0];
		expect([prefix, id]).toEqual(['wanted', shaOf(HOSTILE)]);
		expect(xml).toContain('part1of2.abc123@news.example.invalid');
		for (const gone of ['424242', 'indexer.example', 'ZP1M', 'someone', sponsorKey]) {
			expect(xml).not.toContain(gone);
		}
		// The only record is the sha: no column could name the sender.
		expect(mockRepository.markWantedNzbHeld).toHaveBeenCalledWith(shaOf(HOSTILE));
		expect(mockRepository.markWantedNzbHeld.mock.calls[0]).toHaveLength(1);
	});

	it('takes a gzipped body, hashed as inflated', async () => {
		const res = await put(shaOf(PLAIN), gzipSync(PLAIN), { 'content-encoding': 'gzip' });
		expect(res._getStatusCode()).toBe(200);
		expect(putStoredNzb).toHaveBeenCalledTimes(1);
	});

	it('refuses bytes that do not hash to the sha', async () => {
		const res = await put(SHA, PLAIN);
		expect(res._getStatusCode()).toBe(400);
		expect(putStoredNzb).not.toHaveBeenCalled();
	});

	it('refuses a sha this sponsor never reported as grabbed', async () => {
		mockRepository.reportedWantedNzb = vi.fn().mockResolvedValue(false);
		const res = await put(shaOf(PLAIN), PLAIN);
		expect(res._getStatusCode()).toBe(404);
		expect(putStoredNzb).not.toHaveBeenCalled();
	});

	it('answers a repeat without storing again', async () => {
		mockRepository.heldWantedNzbs = vi.fn().mockResolvedValue(new Set([shaOf(PLAIN)]));
		const res = await put(shaOf(PLAIN), PLAIN);
		expect(res._getStatusCode()).toBe(200);
		expect(putStoredNzb).not.toHaveBeenCalled();
	});

	it('refuses a body that is not an NZB', async () => {
		const body = Buffer.from('<html>not an nzb</html>');
		expect((await put(shaOf(body), body))._getStatusCode()).toBe(400);
		expect(putStoredNzb).not.toHaveBeenCalled();
	});

	it('refuses more than 8 MB, declared or inflated', async () => {
		const big = Buffer.alloc(8 * 1024 * 1024 + 1, 0x20);
		expect((await put(shaOf(big), big))._getStatusCode()).toBe(413);
		const bomb = gzipSync(big);
		expect(
			(
				await put(shaOf(big), bomb, {
					'content-encoding': 'gzip',
					'content-length': String(bomb.length),
				})
			)._getStatusCode()
		).toBe(413);
		expect(putStoredNzb).not.toHaveBeenCalled();
	});

	it('does not mark an NZB held when the store did not take it', async () => {
		vi.mocked(putStoredNzb).mockResolvedValue(false);
		const res = await put(shaOf(PLAIN), PLAIN);
		expect(res._getStatusCode()).toBe(503);
		expect(mockRepository.markWantedNzbHeld).not.toHaveBeenCalled();
	});

	it('refuses a malformed sha, and limits on its own budget', async () => {
		expect((await put('A'.repeat(64), PLAIN))._getStatusCode()).toBe(400);
		vi.mocked(checkRateLimitFor).mockResolvedValue(false);
		const res = await put(shaOf(PLAIN), PLAIN);
		expect(res._getStatusCode()).toBe(429);
		expect(checkRateLimitFor).toHaveBeenLastCalledWith(
			'sponsor:ZP1M',
			RATE_LIMIT_CONFIGS.sponsorWantedNzb,
			res
		);
	});
});

describe('GET /api/wanted/history', () => {
	const get = async (id?: string) => {
		const res = createMockResponse();
		await siteHistoryHandler(
			createMockRequest({ method: 'GET', query: id ? { id } : {} }),
			res
		);
		return res;
	};
	beforeEach(() => {
		vi.mocked(requireSponsor).mockResolvedValue({ shortId: 'ZP1M', keyVersion: 1 } as never);
	});

	it('answers the snapshot and events without the key or the release id a token named', async () => {
		mockRepository.wantedHistory = vi.fn().mockResolvedValue({
			seasons: [{ season: 1, have: [1, 2], missing: [7] }],
			events: [
				{
					at: new Date('2026-11-19T13:29:00Z'),
					kind: 'grabbed',
					reason: '',
					detail: '',
					release: 'Show.S01E07.1080p.WEB.h264-GRP',
					torrent: false,
					hash: null,
					nzb: SHA,
					dmmId: 'ds:native-1',
					size: 1234567890,
					posted: null,
					season: 1,
					episode: 7,
					pack: false,
					resolution: '1080p',
				},
			],
		});
		const res = await get(ID);

		expect(res._getStatusCode()).toBe(200);
		expect(mockRepository.wantedHistory).toHaveBeenCalledWith('ZP1M', ID);
		const body = res._getData() as { seasons: unknown; events: Record<string, unknown>[] };
		expect(body.seasons).toEqual([{ season: 1, have: [1, 2], missing: [7] }]);
		expect(body.events).toEqual([
			{
				at: '2026-11-19T13:29:00.000Z',
				kind: 'grabbed',
				reason: '',
				detail: '',
				release: 'Show.S01E07.1080p.WEB.h264-GRP',
				torrent: false,
				hash: '',
				nzb: SHA,
				dmm_id: encryptReleaseId('ds', 'native-1'),
				size: 1234567890,
				season: 1,
				episode: 7,
				pack: false,
				resolution: '1080p',
			},
		]);
		expect(JSON.stringify(body)).not.toContain('native-1');
	});

	it('answers 404 for an item not on the list and 400 for a bad id', async () => {
		mockRepository.wantedHistory = vi.fn().mockResolvedValue(null);
		expect((await get(ID))._getStatusCode()).toBe(404);
		expect((await get('nope'))._getStatusCode()).toBe(400);
		expect((await get())._getStatusCode()).toBe(400);
	});
});
