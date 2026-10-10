import {
	ms,
	pauseWindows,
	rdRefusalError,
	recordedAnswer,
	refusedReleases,
	sequence,
	type SequenceName,
} from '@/test/realdebrid/rdAddPauseReplay';
import toast from 'react-hot-toast';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Real-Debrid answers an add with `451 infringing_file` far more often because
// it is refusing every add on the account for a while than because it refuses
// the release. These cases replay what a test account answered on 2026-10-04/05
// (src/test/fixtures/realdebrid/rd-add-account-pause-2026-10-05.json) through
// the real add path: `handleAddAsMagnetInRd` over the real `addHashAsMagnet`,
// with only the HTTP layer answered from the recording.

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

import {
	__testing,
	isRdThrottling,
	rdAddPauseRemainingMs,
	resetRdThrottleTracking,
} from '@/services/realDebrid';
import { handleAddAsMagnetInRd } from './addMagnet';
import { RD_ADD_PAUSE_MS, rdAddPauseRetryMessage, rdAddRefusedMessage } from './rdAddPause';

const TOKEN = 'rd-token-of-the-recorded-account';
const OTHER_TOKEN = 'rd-token-of-someone-else';
const CLEAN_TITLE = 'Some.Show.S01E01.1080p.BluRay.x265-GROUP';
const BLOCKED_TITLE = 'Some.Show.S01E01.1080p.WEB-DL.DDP5.1.H.264-GROUP';

const at = (name: SequenceName, role: string, hash?: string) => {
	const add = sequence(name).find((a) => a.role === role && (!hash || a.hash === hash));
	if (!add) throw new Error(`no ${role} add in ${name}`);
	return add;
};

/** Every addMagnet the code sent, with the token, hash and instant it went out. */
let sent: { token: string; hash: string; at: number; status: number }[];

const realAxios = __testing.realDebridAxios as any;

beforeEach(() => {
	vi.useFakeTimers();
	vi.clearAllMocks();
	resetRdThrottleTracking();
	sent = [];
	let nextId = 0;
	realAxios.post = vi.fn(async (url: string, body: string, config: any) => {
		if (url.endsWith('/torrents/addMagnet')) {
			const hash = /btih%3A([0-9a-f]{40})/i.exec(body)?.[1]?.toLowerCase() ?? '';
			const token = String(config.headers.Authorization).replace('Bearer ', '');
			const status = recordedAnswer(hash, Date.now());
			sent.push({ token, hash, at: Date.now(), status });
			if (status === 451) throw rdRefusalError();
			return { status: 201, data: { id: `T${++nextId}` } };
		}
		return { status: 204, data: {} };
	});
	realAxios.get = vi.fn(async (url: string) => ({
		data: {
			id: url.split('/').pop(),
			status: 'downloaded',
			progress: 100,
			files: [{ id: 1, path: '/Some.Show.S01E01.mkv', bytes: 1, selected: 1 }],
			links: ['https://real-debrid.com/d/ABC'],
		},
	}));
});

afterEach(() => {
	vi.useRealTimers();
});

describe('the replayed recording', () => {
	// The replay is only worth driving the code with if it answers what RD
	// actually answered, at the instant it answered it.
	it('reproduces every recorded answer', () => {
		for (const name of ['et', 'extend', 'f1', 'r2'] as SequenceName[]) {
			for (const add of sequence(name)) {
				expect([name, add.at, recordedAnswer(add.hash, ms(add.at))]).toEqual([
					name,
					add.at,
					add.status,
				]);
			}
		}
	});

	it('holds the pauses the recording shows, Big Buck Bunny refused in one', () => {
		const bbb = at('et', 'warm', 'dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c');
		expect(bbb.status).toBe(451);
		const lengths = pauseWindows().map((w) => (w.until - w.from) / 1000);
		// From a few seconds at the shortest to the three-minute one of 23:33.
		expect(Math.min(...lengths)).toBeLessThan(RD_ADD_PAUSE_MS / 1000);
		expect(Math.max(...lengths)).toBeGreaterThan(180);
		// E.T. was refused twice and then accepted: it is no refused release.
		expect(refusedReleases().has('65d1bb05a8064b21ff4359980564ef0691ae84ff')).toBe(false);
	});
});

describe('an add RD answers with a 451 its name does not explain', () => {
	it('is tried once more after the pause and lands (r2, 01:00:47)', async () => {
		// A hash the account accepted three times that evening, refused at
		// 01:00:47 because the whole account was refusing adds.
		const control = at('r2', 'control');
		expect(control.status).toBe(451);
		vi.setSystemTime(ms(control.at));

		const result = handleAddAsMagnetInRd(
			TOKEN,
			control.hash,
			undefined,
			false,
			0,
			false,
			CLEAN_TITLE
		);
		await vi.advanceTimersByTimeAsync(RD_ADD_PAUSE_MS + 1000);

		await expect(result).resolves.toBe('success');
		expect(sent.map((s) => s.status)).toEqual([451, 201]);
		expect(sent[1].at - sent[0].at).toBeGreaterThanOrEqual(RD_ADD_PAUSE_MS);
		expect(toast).toHaveBeenCalledWith(rdAddPauseRetryMessage(), expect.anything());
		expect(toast.success).toHaveBeenCalledWith('Torrent added.', expect.anything());
		expect(toast.error).not.toHaveBeenCalled();
	});

	it("holds the account's other adds instead of firing them into the pause (r2)", async () => {
		const fresh = at('r2', 'fresh', 'c5c19c1c8c8ddaa6f3094987cf71f96330025025');
		const control = at('r2', 'control');
		const pause = pauseWindows().find((w) => w.from === ms(fresh.at))!;
		vi.setSystemTime(ms(fresh.at));

		const first = handleAddAsMagnetInRd(TOKEN, fresh.hash, undefined, false, 0, false, '');
		await vi.advanceTimersByTimeAsync(ms(control.at) - ms(fresh.at));
		// The user adds the next release five seconds later, as the probe did.
		const second = handleAddAsMagnetInRd(TOKEN, control.hash, undefined, false, 0, false, '');
		await vi.advanceTimersByTimeAsync(2 * RD_ADD_PAUSE_MS);

		await expect(second).resolves.toBe('success');
		await expect(first).resolves.toBe('success');
		// Nothing went to RD from this account between the 451 and the end of
		// the hold, so nothing else was refused for being fired into the pause.
		const during = sent.filter(
			(s) => s.at > ms(fresh.at) && s.at < ms(fresh.at) + RD_ADD_PAUSE_MS
		);
		expect(during).toEqual([]);
		expect(sent.filter((s) => s.status === 451)).toHaveLength(1);
		expect(sent.every((s) => s.at === ms(fresh.at) || s.at >= pause.until)).toBe(true);
	});

	it('keeps trying through the three-minute pause of 23:33 and lands (f1)', async () => {
		// A hash new to the account, refused at 23:33:02 as the account began
		// refusing every add, known-good probes included, until 23:36:10. One
		// try 30 s later fell inside that pause too, and the user was told RD
		// refused the release while it was refusing everything.
		const fresh = at('f1', 'fresh', '28c6795228d624c68bc86704c6bd94db495d73dd');
		const pause = pauseWindows().find((w) => w.from === ms(fresh.at))!;
		expect((pause.until - pause.from) / 1000).toBeGreaterThan(180);
		vi.setSystemTime(ms(fresh.at));

		const result = handleAddAsMagnetInRd(
			TOKEN,
			fresh.hash,
			undefined,
			false,
			0,
			false,
			CLEAN_TITLE
		);
		await vi.advanceTimersByTimeAsync(6 * 60_000);

		await expect(result).resolves.toBe('success');
		expect(sent.at(-1)!.status).toBe(201);
		expect(sent.at(-1)!.at).toBeGreaterThanOrEqual(pause.until);
		expect(toast.success).toHaveBeenCalledWith('Torrent added.', expect.anything());
		expect(toast.error).not.toHaveBeenCalled();
	});

	it('says the account is still refusing, and no verdict, after five minutes of 451s (f1)', async () => {
		// Refused at 23:31:02 while the account accepted a control six seconds
		// later: RD refusing that release, as far as the recording can tell.
		const refused = at('f1', 'fresh', '1f0313cced4f79eef74532258041206f1e9a1ed4');
		vi.setSystemTime(ms(refused.at));

		const result = handleAddAsMagnetInRd(
			TOKEN,
			refused.hash,
			undefined,
			false,
			0,
			false,
			CLEAN_TITLE
		);
		await vi.advanceTimersByTimeAsync(6 * 60_000);

		// 'paused', not 'infringing_file': only a blocked name is a verdict.
		await expect(result).resolves.toBe('paused');
		expect(sent.map((s) => s.status)).toEqual([451, 451, 451, 451]);
		// Tried after holds of 30 s, 90 s and 3 minutes, each announced.
		const gaps = sent.slice(1).map((s, i) => s.at - sent[i].at);
		expect(gaps.map((g) => Math.round(g / 1000))).toEqual([30, 90, 180]);
		for (const hold of ['30 seconds', '90 seconds', '3 minutes']) {
			expect(toast).toHaveBeenCalledWith(expect.stringContaining(hold), expect.anything());
		}
		expect(toast.error).toHaveBeenCalledTimes(1);
		expect(toast.error).toHaveBeenCalledWith(
			rdAddRefusedMessage(5 * 60_000),
			expect.objectContaining({ duration: 15_000 })
		);
		expect(rdAddRefusedMessage(5 * 60_000)).toContain('after 5 minutes');
		expect(rdAddRefusedMessage(5 * 60_000)).toContain('not about this release');
	});

	it('answers a silent probe at once, as unanswered, without waiting (et)', async () => {
		// Big Buck Bunny, refused at 22:53:00 during the pause.
		const bbb = at('et', 'warm', 'dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c');
		vi.setSystemTime(ms(bbb.at));

		const result = await handleAddAsMagnetInRd(
			TOKEN,
			bbb.hash,
			undefined,
			false,
			0,
			true,
			'Big Buck Bunny'
		);

		expect(result).toBe('paused');
		expect(sent).toHaveLength(1);
		expect(Date.now()).toBe(ms(bbb.at));
		// What lets an availability check read the empty probe as "RD did not
		// say" rather than "not cached".
		expect(isRdThrottling(TOKEN)).toBe(true);
		expect(toast).not.toHaveBeenCalled();
		expect(toast.error).not.toHaveBeenCalled();
	});

	it("never holds another account's adds", async () => {
		const control = at('r2', 'control');
		vi.setSystemTime(ms(control.at));
		void handleAddAsMagnetInRd(TOKEN, control.hash, undefined, false, 0, true, '');
		await vi.advanceTimersByTimeAsync(0);
		expect(rdAddPauseRemainingMs(TOKEN)).toBeGreaterThan(0);

		vi.setSystemTime(ms(at('r2', 'probe').at));
		const other = await handleAddAsMagnetInRd(
			OTHER_TOKEN,
			at('r2', 'probe').hash,
			undefined,
			false,
			0,
			true,
			''
		);

		expect(other).toBe('success');
		expect(rdAddPauseRemainingMs(OTHER_TOKEN)).toBe(0);
		expect(isRdThrottling(OTHER_TOKEN)).toBe(false);
	});
});

describe('a 451 on a name RD blocks', () => {
	it('is a refusal at once, and holds nothing else', async () => {
		const refused = at('f1', 'fresh', '46835a8f83fa9878bfc96d161eed203e7a259da4');
		vi.setSystemTime(ms(refused.at));

		const result = await handleAddAsMagnetInRd(
			TOKEN,
			refused.hash,
			undefined,
			false,
			0,
			false,
			BLOCKED_TITLE
		);

		expect(result).toBe('infringing_file');
		expect(sent).toHaveLength(1);
		expect(rdAddPauseRemainingMs(TOKEN)).toBe(0);
		expect(toast).not.toHaveBeenCalledWith(rdAddPauseRetryMessage(), expect.anything());
	});
});
