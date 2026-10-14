import fixture from '@/test/fixtures/realdebrid/rd-add-name-retest-2026-10-13.json';
import { AxiosError, AxiosHeaders } from 'axios';
import bencode from 'bencode';
import toast from 'react-hot-toast';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Real-Debrid's addMagnet answers from a retest on a test account nothing else
// adds on, 2026-10-13/14 (src/test/fixtures/realdebrid/rd-add-name-retest-2026-10-13.json),
// replayed through every add path that used to send RD nothing but the hash.
// Those paths took a 451 on a name RD blocks for the account's pause: they held
// the user's whole account and tried the same hash again, which RD refused
// again. Only the HTTP layer and DMM's database are stubbed.

vi.mock('next/config', () => ({
	default: () => ({
		publicRuntimeConfig: {
			proxy: '',
			authProxy: '',
			realDebridHostname: 'https://app.real-debrid.com',
			realDebridClientId: 'CLIENT_ID',
		},
	}),
}));
vi.mock('@/lib/observability/rdOperationalStats', () => ({ recordRdOperationEvent: vi.fn() }));
vi.mock('@/utils/deleteTorrent', () => ({ handleDeleteRdTorrent: vi.fn(async () => true) }));
vi.mock('react-hot-toast', () => {
	const fn: any = vi.fn();
	fn.success = vi.fn();
	fn.error = vi.fn();
	fn.loading = vi.fn();
	fn.dismiss = vi.fn();
	return { default: fn };
});
// The names DMM's RD availability table holds, by hash: what a path that has
// only the hash can look up.
const namesOnRecord = new Map<string, string>();
vi.mock('@/services/repository', () => ({
	repository: {
		getCachedRdNames: vi.fn(async (hashes: string[]) => {
			const rows = new Map();
			for (const hash of hashes) {
				const name = namesOnRecord.get(hash.toLowerCase());
				if (name) rows.set(hash.toLowerCase(), { filename: name, originalFilename: name });
			}
			return rows;
		}),
	},
}));

import { __testing, rdAddPauseRemainingMs, resetRdThrottleTracking } from '@/services/realDebrid';
import { isRdBlockedName } from '@/utils/deInfringe';
import {
	handleAddMultipleHashesInRd,
	handleAddTorrentFileInRd,
	handleReinsertTorrentinRd,
} from './addMagnet';
import { getBiggestFileStreamUrl, getStreamUrl } from './getStreamUrl';
import { getInstantIntent } from './intent';
import { RD_ADD_PAUSE_MS, RD_NAME_REFUSED_MESSAGE } from './rdAddPause';

type RecordedAdd = (typeof fixture.adds)[number];

const TOKEN = 'rd-token-of-the-test-account';
const NAME_REFUSAL = /because of its name/;

const pass = (n: number) => fixture.adds.filter((a) => a.pass === n);
const reAdd = (hash: string) => pass(2).find((a) => a.hash === hash);
const tagged = (add: RecordedAdd) => isRdBlockedName(add.title);

/** Releases RD refused in pass 1 under a name it blocks. */
const refusedTagged = pass(1).filter((a) => a.status === 451 && tagged(a));
/** Releases RD refused in pass 1 under a clean name and accepted when added again. */
const refusedCleanThenAccepted = pass(1).filter(
	(a) => a.status === 451 && !tagged(a) && reAdd(a.hash)?.status === 201
);

/** Every add the code sent RD, in order. */
let sent: { hash: string; at: number; status: number }[];
/** The add `addTorrent` answers, which carries a file rather than a hash. */
let torrentFileAdd: RecordedAdd | null;

/** RD's answer to the nth add of this hash: pass 1's first, then pass 2's. */
const recordedAnswer = (hash: string): number => {
	const first = pass(1).find((a) => a.hash === hash);
	if (!first) return 201;
	const earlier = sent.filter((s) => s.hash === hash).length;
	return earlier === 0 ? first.status : (reAdd(hash)?.status ?? first.status);
};

const refusal = () =>
	new AxiosError('Request failed with status code 451', 'ERR_BAD_REQUEST', undefined, undefined, {
		status: fixture.refusal.status,
		statusText: '',
		data: fixture.refusal.body,
		headers: {},
		config: { headers: new AxiosHeaders() },
	});

const answer = (hash: string) => {
	const status = recordedAnswer(hash);
	sent.push({ hash, at: Date.now(), status });
	if (status === 451) throw refusal();
	return { status: 201, data: { id: `T-${hash.slice(0, 6)}` } };
};

const realAxios = __testing.realDebridAxios as any;

beforeEach(() => {
	vi.useFakeTimers();
	vi.clearAllMocks();
	resetRdThrottleTracking();
	namesOnRecord.clear();
	sent = [];
	torrentFileAdd = null;
	realAxios.post = vi.fn(async (url: string, body: string) => {
		if (url.endsWith('/torrents/addMagnet')) {
			return answer(/btih%3A([0-9a-f]{40})/i.exec(body)![1].toLowerCase());
		}
		if (url.endsWith('/unrestrict/link')) {
			return {
				status: 200,
				data: {
					id: 'U1',
					filename: 'Movie.mkv',
					filesize: 1 << 30,
					link: 'https://real-debrid.com/d/ABCDEFGHIJKLM',
					download: 'https://download.real-debrid.com/d/ABC/Movie.mkv',
					streamable: 1,
				},
			};
		}
		return { status: 204, data: {} };
	});
	realAxios.put = vi.fn(async () => answer(torrentFileAdd!.hash));
	realAxios.get = vi.fn(async (url: string) => ({
		status: 200,
		data: {
			id: url.split('/').pop(),
			filename: 'Movie.mkv',
			status: 'downloaded',
			progress: 100,
			files: [{ id: 1, path: '/Movie.mkv', bytes: 1 << 30, selected: 1 }],
			links: ['https://real-debrid.com/d/ABCDEFGHIJKLM'],
		},
	}));
	realAxios.delete = vi.fn(async () => ({ status: 204, data: {} }));
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init?: RequestInit) => {
			if (url === '/api/challenge') {
				return { ok: true, json: async () => ({ token: 'tok', hash: 'sig' }) };
			}
			if (url === '/api/availability/check2') {
				const { hashes } = JSON.parse(String(init?.body));
				const available = (hashes as string[])
					.filter((h) => namesOnRecord.has(h))
					.map((h) => ({
						hash: h,
						filename: namesOnRecord.get(h),
						originalFilename: namesOnRecord.get(h),
						files: [],
					}));
				return { ok: true, json: async () => ({ available }) };
			}
			throw new Error(`unexpected fetch ${url}`);
		})
	);
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

/**
 * Runs one add path to the end, letting fake time pass for any hold it puts
 * on the account, and reports what RD was sent and how long the caller waited.
 */
async function drive(run: () => Promise<unknown>) {
	const started = Date.now();
	let settledAt = -1;
	let outcome: { value?: unknown; error?: unknown } = {};
	const done = run().then(
		(value) => {
			outcome = { value };
		},
		(error) => {
			outcome = { error };
		}
	);
	void done.finally(() => {
		settledAt = Date.now();
	});
	await vi.advanceTimersByTimeAsync(0);
	const heldTheAccount = rdAddPauseRemainingMs(TOKEN) > 0;
	await vi.advanceTimersByTimeAsync(60 * 60_000);
	await done;
	const message = (outcome.error as Error | undefined)?.message;
	return { adds: sent.length, waitedMs: settledAt - started, heldTheAccount, message, outcome };
}

/** What a path did with a release RD refuses by name: one add, no hold, said so. */
const refusedOnce = { adds: 1, waitedMs: 0, heldTheAccount: false, refusedByName: true };

const eachRefusedTagged = async (
	run: (add: RecordedAdd) => Promise<unknown>,
	refusedByName: (r: Awaited<ReturnType<typeof drive>>) => boolean
) => {
	const results = [];
	for (const add of refusedTagged) {
		resetRdThrottleTracking();
		sent = [];
		vi.mocked(toast.error).mockClear();
		vi.setSystemTime(Date.parse(add.at));
		const r = await drive(() => run(add));
		results.push({
			title: add.title,
			adds: r.adds,
			waitedMs: r.waitedMs,
			heldTheAccount: r.heldTheAccount,
			refusedByName: refusedByName(r),
		});
	}
	return results;
};

const expectEveryRefusedOnce = (results: { title: string }[]) =>
	expect(results).toEqual(refusedTagged.map((a) => ({ title: a.title, ...refusedOnce })));

const toastSaidNameRefusal = () =>
	vi.mocked(toast.error).mock.calls.some(([message]) => NAME_REFUSAL.test(String(message)));

describe('the recording', () => {
	it('shows a 451 on a name RD blocks is the release, and one on a clean name mostly is not', () => {
		expect(pass(1)).toHaveLength(76);
		// 37 of the 44 releases with a blocked name were refused, and RD took
		// one of those 37 when it was added again an hour later. Under the
		// 2026-10-10 rule 46 read as blocked; the other two, How to Train Your
		// Dragon as WEB.h264 and as Web-Dl, were taken at once, which is how the
		// 2026-10-14 re-measurement started.
		expect(pass(1).filter(tagged)).toHaveLength(44);
		expect(refusedTagged).toHaveLength(37);
		expect(refusedTagged.filter((a) => reAdd(a.hash)?.status === 201)).toHaveLength(1);
		// 9 of the 32 clean names were refused, and 4 of those went through later:
		// RD's pause on the account, which the existing retry is for.
		const refusedClean = pass(1).filter((a) => a.status === 451 && !tagged(a));
		expect(refusedClean).toHaveLength(9);
		expect(refusedCleanThenAccepted).toHaveLength(4);
		// A 451 on a clean name came with the control refused too, a block of
		// 36 s to 4 min, as often as not.
		expect(refusedClean.filter((a) => a.control === 451).map((a) => a.blockSeconds)).toEqual(
			expect.arrayContaining([36, 56])
		);
	});
});

describe('a release RD refuses by name', () => {
	it('is refused at once by a Stremio cast, by the name DMM has on record', async () => {
		const results = await eachRefusedTagged(
			(add) => {
				namesOnRecord.set(add.hash, add.title);
				return getStreamUrl(TOKEN, add.hash, 1, '1.2.3.4', 'movie');
			},
			(r) => NAME_REFUSAL.test(r.message ?? '')
		);
		expectEveryRefusedOnce(results);
	});

	it('is refused at once by a movie cast', async () => {
		const results = await eachRefusedTagged(
			(add) => {
				namesOnRecord.set(add.hash, add.title);
				return getBiggestFileStreamUrl(TOKEN, add.hash, '1.2.3.4');
			},
			(r) => NAME_REFUSAL.test(r.message ?? '')
		);
		expectEveryRefusedOnce(results);
	});

	it('is refused at once by a player link, without calling it temporary', async () => {
		const results = await eachRefusedTagged(
			(add) => {
				namesOnRecord.set(add.hash, add.title);
				return getInstantIntent(TOKEN, add.hash, 1, '1.2.3.4', 'android', 'vlc', 'rd');
			},
			(r) => {
				const value = r.outcome.value as { error?: string; temporary?: boolean };
				return value.error === RD_NAME_REFUSED_MESSAGE && !value.temporary;
			}
		);
		expectEveryRefusedOnce(results);
	});

	it('is refused at once in a pasted list of magnets, by their own names', async () => {
		const results = await eachRefusedTagged(
			(add) =>
				handleAddMultipleHashesInRd(TOKEN, [
					`magnet:?xt=urn:btih:${add.hash}&dn=${encodeURIComponent(add.title)}`,
				]),
			toastSaidNameRefusal
		);
		expectEveryRefusedOnce(results);
	});

	it('is refused at once in a pasted list of bare hashes, by the name DMM has on record', async () => {
		const results = await eachRefusedTagged((add) => {
			namesOnRecord.set(add.hash, add.title);
			return handleAddMultipleHashesInRd(TOKEN, [add.hash]);
		}, toastSaidNameRefusal);
		expectEveryRefusedOnce(results);
	});

	it('is refused at once as a .torrent file, by the name inside it', async () => {
		const results = await eachRefusedTagged((add) => {
			torrentFileAdd = add;
			const bytes = bencode.encode({
				info: { name: add.title, 'piece length': 16384, length: 1, pieces: '' },
			}) as Uint8Array;
			const file = { name: 'release.torrent', arrayBuffer: async () => bytes.slice().buffer };
			return handleAddTorrentFileInRd(TOKEN, file as unknown as File);
		}, toastSaidNameRefusal);
		expectEveryRefusedOnce(results);
	});

	it('is refused at once when reinserted from the library', async () => {
		const results = await eachRefusedTagged(
			(add) =>
				handleReinsertTorrentinRd(
					TOKEN,
					{ id: 'rd:OLD', hash: add.hash, filename: add.title } as any,
					true,
					['1']
				),
			(r) => NAME_REFUSAL.test(r.message ?? '')
		);
		expectEveryRefusedOnce(results);
	});
});

describe('a release RD refused under a clean name and took later', () => {
	it('is still tried again after the account pause, and lands', async () => {
		for (const add of refusedCleanThenAccepted) {
			resetRdThrottleTracking();
			sent = [];
			vi.setSystemTime(Date.parse(add.at));
			namesOnRecord.set(add.hash, add.title);
			const r = await drive(() => getStreamUrl(TOKEN, add.hash, 1, '1.2.3.4', 'movie'));
			expect([add.title, r.adds, r.heldTheAccount, r.outcome.error]).toEqual([
				add.title,
				2,
				true,
				undefined,
			]);
			expect(r.waitedMs).toBeGreaterThanOrEqual(RD_ADD_PAUSE_MS);
		}
	});
});
