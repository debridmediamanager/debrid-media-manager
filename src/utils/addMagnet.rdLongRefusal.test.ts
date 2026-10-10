import fixture from '@/test/fixtures/realdebrid/rd-long-refusal-2026-10-07.json';
import { rdRefusalError } from '@/test/realdebrid/rdAddPauseReplay';
import toast from 'react-hot-toast';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Some accounts are refused by Real-Debrid for hours, not for the 21 s to five
// minutes of the pauses measured 2026-10-04/05. A Reddit user was told
// "Real-Debrid is pausing adds on your account. Trying again in 30 seconds..."
// for twelve hours. These cases replay what DMM's RD proxy log recorded for six
// browsers on 2026-10-04..07 (src/test/fixtures/realdebrid/rd-long-refusal-2026-10-07.json)
// through the real add path, with only the HTTP layer answered from the log.

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
vi.mock('./deleteTorrent', () => ({ handleDeleteRdTorrent: vi.fn(async () => true) }));
vi.mock('react-hot-toast', () => {
	const fn: any = vi.fn();
	fn.success = vi.fn();
	fn.error = vi.fn();
	fn.loading = vi.fn();
	fn.dismiss = vi.fn();
	return { default: fn };
});

import { rdLongRefusal, resetRdAddOutcomes } from '@/services/rdAddOutcomes';
import { __testing, addHashAsMagnet, resetRdThrottleTracking } from '@/services/realDebrid';
import { handleAddAsMagnetInRd } from './addMagnet';
import { rdAddPauseRetryMessage, rdAddRefusedMessage } from './rdAddPause';

type Client = keyof typeof fixture.clients;
const timeline = (client: Client) =>
	fixture.clients[client].map(([at, status]) => ({
		at: Date.parse(at as string),
		status: status as number,
	}));

const TOKEN = 'rd-token-of-the-recorded-browser';
const HASH = '0123456789abcdef0123456789abcdef01234567';
const CLEAN_TITLE = 'Some.Movie.2024.1080p.BluRay.x265-GROUP';

const realAxios = __testing.realDebridAxios as any;
/** What RD answers the next addMagnet: the recorded status, or 451 from then on. */
let answer: number;

beforeEach(() => {
	vi.useFakeTimers();
	vi.clearAllMocks();
	resetRdThrottleTracking();
	resetRdAddOutcomes();
	let nextId = 0;
	realAxios.post = vi.fn(async (url: string) => {
		if (url.endsWith('/torrents/addMagnet')) {
			if (answer === 451) throw rdRefusalError();
			return { status: 201, data: { id: `T${++nextId}` } };
		}
		return { status: 204, data: {} };
	});
	realAxios.get = vi.fn(async (url: string) => ({
		data: {
			id: url.split('/').pop(),
			status: 'downloaded',
			progress: 100,
			files: [{ id: 1, path: '/Some.Movie.mkv', bytes: 1, selected: 1 }],
			links: ['https://real-debrid.com/d/ABC'],
		},
	}));
});

afterEach(() => {
	vi.useRealTimers();
});

/**
 * Sends each recorded add through `addHashAsMagnet` at its recorded instant,
 * and reports, at every 451, what the account's log made of it. The pause a
 * 451 puts on the account is dropped between adds: the recording already has
 * them as far apart as the browser sent them.
 */
async function replay(adds: { at: number; status: number }[]) {
	const atRefusals: (ReturnType<typeof rdLongRefusal> & { at: number })[] = [];
	for (const add of adds) {
		resetRdThrottleTracking();
		vi.setSystemTime(add.at);
		answer = add.status;
		await addHashAsMagnet(TOKEN, HASH).catch(() => null);
		if (add.status === 451) {
			const long = rdLongRefusal(TOKEN);
			atRefusals.push(long ? { ...long, at: add.at } : (null as any));
		}
	}
	return atRefusals;
}

describe('the recorded browsers', () => {
	it('reads the overnight one as refused for hours, 17 of 18 over 12 hours, despite its one success', async () => {
		const adds = timeline('refusedOvernight');
		expect(adds.filter((a) => a.status === 451)).toHaveLength(17);
		const atRefusals = await replay(adds);
		// The first evening session lasted 20 minutes: still a pause then.
		expect(atRefusals.slice(0, 6).every((r) => r === null)).toBe(true);
		const last = atRefusals[atRefusals.length - 1];
		expect(last).toMatchObject({ refused: 17, tries: 18 });
		expect(Math.round(last!.forMs / 3_600_000)).toBe(12);
	});

	it.each(['refusedForDays', 'refusedAcrossVisits', 'bulkRefusedForHours'] as Client[])(
		'reads %s as refused for longer than a pause by its last refusal',
		async (client) => {
			const atRefusals = await replay(timeline(client));
			expect(atRefusals[atRefusals.length - 1]).not.toBeNull();
		}
	);

	it('never reads a browser whose pauses ended in accepted adds as refused for hours', async () => {
		const adds = timeline('ordinaryPauses');
		expect(adds.filter((a) => a.status === 451).length).toBeGreaterThan(30);
		const atRefusals = await replay(adds);
		expect(atRefusals.every((r) => r === null)).toBe(true);
	});

	it('reads a bulk run only where nearly every add was refused, and says how many were', async () => {
		const atRefusals = (await replay(timeline('bulkMostlyRefused'))).filter(Boolean);
		expect(atRefusals.length).toBeGreaterThan(0);
		for (const r of atRefusals)
			expect(r!.tries - r!.refused).toBeLessThanOrEqual(r!.refused / 10);
	});
});

describe('an add the user is watching', () => {
	it('tells the overnight browser RD has refused it for hours and sends it to real-debrid.com', async () => {
		// Replay up to its single success at 11:05:52, then the add at 11:06:05
		// that RD refused through every hold: 12 refused and 1 accepted before it,
		// then its own four tries.
		const adds = timeline('refusedOvernight');
		const success = adds.findIndex((a) => a.status === 201);
		await replay(adds.slice(0, success + 1));
		resetRdThrottleTracking();
		vi.setSystemTime(adds[success + 1].at);
		answer = 451;

		const result = handleAddAsMagnetInRd(TOKEN, HASH, undefined, false, 0, false, CLEAN_TITLE);
		await vi.advanceTimersByTimeAsync(6 * 60_000);

		await expect(result).resolves.toBe('paused');
		const retries = vi.mocked(toast).mock.calls.map(([message]) => message as string);
		expect(retries).toHaveLength(3);
		for (const message of retries) {
			expect(message).toMatch(
				/^Real-Debrid has refused \d+ of the last \d+ adds on your account over 12 hours\. Trying again in /
			);
			expect(message).not.toContain('pausing');
		}
		const [refusal] = vi.mocked(toast.error).mock.calls[0];
		expect(refusal).toBe(rdAddRefusedMessage(5 * 60_000, rdLongRefusal(TOKEN)));
		expect(refusal).toContain('Real-Debrid has refused 16 of the last 17 adds');
		expect(refusal).toContain('real-debrid.com');
		expect(refusal).not.toContain('Try again in a few minutes');
	});

	it('still calls a refusal after ordinary pauses a pause', async () => {
		await replay(timeline('ordinaryPauses'));
		resetRdThrottleTracking();
		answer = 451;

		const result = handleAddAsMagnetInRd(TOKEN, HASH, undefined, false, 0, false, CLEAN_TITLE);
		await vi.advanceTimersByTimeAsync(6 * 60_000);

		await expect(result).resolves.toBe('paused');
		expect(toast).toHaveBeenCalledWith(rdAddPauseRetryMessage(), expect.anything());
		expect(toast.error).toHaveBeenCalledWith(
			rdAddRefusedMessage(5 * 60_000),
			expect.anything()
		);
	});
});

describe('the account log', () => {
	it('outlasts a reload and never stores the token', async () => {
		await replay(timeline('refusedOvernight'));
		const stored = window.localStorage.getItem('rd:addOutcomes') ?? '';
		expect(stored).not.toContain(TOKEN);
		expect(JSON.parse(stored)).not.toEqual({});
		expect(rdLongRefusal(TOKEN)).not.toBeNull();
		expect(rdLongRefusal('some-other-token')).toBeNull();
	});
});
