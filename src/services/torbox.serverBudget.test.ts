// @vitest-environment node
import measured from '@/test/fixtures/torbox/server-bursts-2026-10-04.json';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _testing, getTorrentList, requestDownloadLink } from './torbox';

/**
 * Card 224: on the server this client serves every member at once, and its
 * limits - 15 calls in flight, 80 requestdl a minute - were one budget for all
 * of them, with no limit on the wait for a slot. TorBox limits each key on its
 * own, so one member's burst held up everyone else on that replica for as
 * long as their own calls took, and a stalled TorBox held them all until the
 * proxy cut the request at 60 s.
 *
 * The bursts below are the largest single-install ones in dmm-01's access log
 * for the week to 2026-10-04 (see the fixture).
 */

type Reply = { status: number; body: unknown } | 'never';

const net = vi.hoisted(() => ({
	byKey: new Map<string, Reply>(),
	calls: [] as string[],
}));

vi.mock('axios', async (importOriginal) => {
	const actual = await importOriginal<typeof import('axios')>();
	const axios = actual.default;
	axios.defaults.adapter = async (config) => {
		const auth = new actual.AxiosHeaders(config.headers).get('Authorization');
		const key = typeof auth === 'string' ? auth.replace(/^Bearer /, '') : '';
		net.calls.push(`${key} ${axios.getUri(config)}`);
		const reply = net.byKey.get(key);
		if (!reply) throw new Error(`No answer for key ${key}`);
		if (reply === 'never') return new Promise(() => {});
		return {
			data: JSON.stringify(reply.body),
			status: reply.status,
			statusText: '',
			headers: new actual.AxiosHeaders({ 'content-type': 'application/json' }),
			config,
			request: {},
		};
	};
	return actual;
});

vi.mock('next/config', () => ({
	default: () => ({ publicRuntimeConfig: { torboxHostname: 'https://api.torbox.app' } }),
}));
vi.mock('@/lib/observability/torboxOperationalStats', () => ({
	recordTorBoxOperationEvent: vi.fn(),
	resolveTorBoxOperation: vi.fn(() => null),
}));

const OK = { status: 200, body: { success: true, data: [] } };
const LINK = { status: 200, body: { success: true, data: 'https://cdn.example/file.mkv' } };

/** Starts `call` and records how it settled, without awaiting it. */
const track = <T>(call: Promise<T>) => {
	const state: { value?: T; error?: { name?: string }; settled: boolean } = { settled: false };
	call.then(
		(value) => Object.assign(state, { value, settled: true }),
		(error) => Object.assign(state, { error, settled: true })
	);
	return state;
};

beforeEach(() => {
	_testing.resetState();
	net.byKey.clear();
	net.calls.length = 0;
	vi.spyOn(console, 'log').mockImplementation(() => {});
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("TorBox budgets on the server are each member's own", () => {
	const { catalogSecond, playMinute } = measured.bursts;

	it("does not hold one member's call behind another member's burst", async () => {
		net.byKey.set('busy-key', 'never');
		net.byKey.set('other-key', OK);
		// Each library catalog load asks mylist for torrents, web downloads and
		// usenet: 32 loads in one second are 96 calls on one key.
		for (let i = 0; i < catalogSecond.torboxCalls; i++) {
			track(getTorrentList('busy-key'));
		}
		await vi.advanceTimersByTimeAsync(0);

		const other = track(getTorrentList('other-key'));
		await vi.advanceTimersByTimeAsync(100);

		expect(other.settled).toBe(true);
		expect(other.value).toEqual({ success: true, data: [] });
	});

	it('answers a temporary failure instead of waiting forever for a slot', async () => {
		net.byKey.set('busy-key', 'never');
		const calls = Array.from({ length: catalogSecond.torboxCalls }, () =>
			track(getTorrentList('busy-key'))
		);

		await vi.advanceTimersByTimeAsync(_testing.SERVER_MAX_WAIT_MS + 1_000);

		const refused = calls.filter((call) => call.error?.name === 'TorBoxRateLimitError');
		expect(refused).toHaveLength(catalogSecond.torboxCalls - _testing.MAX_GLOBAL_CONCURRENT);
		// The ones TorBox has not answered are still TorBox's to answer.
		expect(calls.filter((call) => !call.settled)).toHaveLength(_testing.MAX_GLOBAL_CONCURRENT);
		expect(net.calls).toHaveLength(_testing.MAX_GLOBAL_CONCURRENT);
	});

	it("spends one member's requestdl budget, not every member's", async () => {
		net.byKey.set('looping-key', LINK);
		net.byKey.set('other-key', LINK);
		const params = { torrent_id: 1, file_id: 0 };
		// One install asked for this many play links in a single minute.
		const loop = Array.from({ length: playMinute.fromOneInstall }, () =>
			track(requestDownloadLink('looping-key', params))
		);
		await vi.advanceTimersByTimeAsync(0);

		const other = track(requestDownloadLink('other-key', params));
		await vi.advanceTimersByTimeAsync(100);

		expect(other.settled).toBe(true);
		expect(other.value).toMatchObject({ success: true });
		// The looping key still gets its own 80, and no more, this minute.
		expect(loop.filter((call) => call.value)).toHaveLength(_testing.ENDPOINT_LIMITS.requestdl);
	});
});
