import { rdRefusalError } from '@/test/realdebrid/rdAddPauseReplay';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	addThroughRdPause,
	formatRdAddWait,
	isRdAddRefusal,
	RD_ADD_INTERACTIVE_HOLDS_MS,
	RD_ADD_PAUSE_GIVE_UP_MS,
	RD_ADD_PAUSE_MS,
	RdAddPausedError,
	rdAddRefusedMessage,
	RdPauseStreak,
	retryRdAddThroughPause,
} from './rdAddPause';

describe('isRdAddRefusal', () => {
	it('reads the 451 RD sent the test account', () => {
		expect(isRdAddRefusal(rdRefusalError())).toBe(true);
	});

	it('reads the error name when a proxy changed the status', () => {
		expect(
			isRdAddRefusal({ response: { status: 403, data: { error: 'infringing_file' } } })
		).toBe(true);
		expect(isRdAddRefusal({ response: { data: { error: 'infringing_file' } } })).toBe(true);
	});

	it('leaves every other failure alone', () => {
		expect(isRdAddRefusal(new Error('network'))).toBe(false);
		expect(isRdAddRefusal({ response: { status: 509, data: {} } })).toBe(false);
		expect(isRdAddRefusal({ response: { status: 429, data: { error_code: 34 } } })).toBe(false);
		expect(
			isRdAddRefusal({
				response: { status: 503, data: { error: 'service_unavailable', error_code: 35 } },
			})
		).toBe(false);
		expect(isRdAddRefusal(null)).toBe(false);
	});
});

describe('retryRdAddThroughPause', () => {
	it('tries a 451 once more and returns what the second try got', async () => {
		const add = vi.fn().mockRejectedValueOnce(rdRefusalError()).mockResolvedValueOnce('id');
		const onPause = vi.fn();

		await expect(retryRdAddThroughPause(add, { onPause })).resolves.toBe('id');
		expect(add).toHaveBeenCalledTimes(2);
		expect(onPause).toHaveBeenCalledTimes(1);
		expect(onPause).toHaveBeenCalledWith(RD_ADD_PAUSE_MS);
	});

	it('keeps trying through each hold it is given, and says how long it waited', async () => {
		const add = vi.fn().mockRejectedValue(rdRefusalError());
		const onPause = vi.fn();

		const error = (await retryRdAddThroughPause(add, {
			holdsMs: RD_ADD_INTERACTIVE_HOLDS_MS,
			onPause,
		}).catch((e) => e)) as RdAddPausedError;

		expect(error).toBeInstanceOf(RdAddPausedError);
		expect(add).toHaveBeenCalledTimes(4);
		expect(onPause.mock.calls.map(([ms]) => ms)).toEqual([30_000, 90_000, 180_000]);
		expect(error.message).toBe(rdAddRefusedMessage(5 * 60_000));
	});

	it('stops at the first try RD accepts', async () => {
		const add = vi
			.fn()
			.mockRejectedValueOnce(rdRefusalError())
			.mockRejectedValueOnce(rdRefusalError())
			.mockResolvedValueOnce('id');

		await expect(
			retryRdAddThroughPause(add, { holdsMs: RD_ADD_INTERACTIVE_HOLDS_MS })
		).resolves.toBe('id');
		expect(add).toHaveBeenCalledTimes(3);
	});

	it('turns a second 451 into a temporary error', async () => {
		const add = vi.fn().mockRejectedValue(rdRefusalError());

		const error = (await retryRdAddThroughPause(add).catch((e) => e)) as RdAddPausedError;

		expect(error).toBeInstanceOf(RdAddPausedError);
		expect(error.temporary).toBe(true);
		expect(add).toHaveBeenCalledTimes(2);
	});

	it('does not retry anything else', async () => {
		const add = vi.fn().mockRejectedValue(new Error('network'));

		await expect(retryRdAddThroughPause(add)).rejects.toThrow('network');
		expect(add).toHaveBeenCalledTimes(1);
	});
});

describe('formatRdAddWait', () => {
	it('says seconds under two minutes and minutes past them', () => {
		expect(formatRdAddWait(1_000)).toBe('1 second');
		expect(formatRdAddWait(30_000)).toBe('30 seconds');
		expect(formatRdAddWait(90_000)).toBe('90 seconds');
		expect(formatRdAddWait(180_000)).toBe('3 minutes');
		expect(formatRdAddWait(300_000)).toBe('5 minutes');
	});
});

describe('addThroughRdPause', () => {
	it('gives a paused add one more try', async () => {
		const add = vi
			.fn()
			.mockImplementationOnce(async (onPaused: () => void) => {
				onPaused();
				return false;
			})
			.mockResolvedValueOnce(true);

		await expect(addThroughRdPause(add)).resolves.toBe('added');
		expect(add).toHaveBeenCalledTimes(2);
	});

	it('reports a release refused twice as paused, not missing', async () => {
		const add = vi.fn(async (onPaused: () => void) => {
			onPaused();
			return false;
		});

		await expect(addThroughRdPause(add)).resolves.toBe('paused');
		expect(add).toHaveBeenCalledTimes(2);
	});

	it('does not retry a plain miss', async () => {
		const add = vi.fn(async () => false);

		await expect(addThroughRdPause(add)).resolves.toBe('failed');
		expect(add).toHaveBeenCalledTimes(1);
	});
});

describe('RdPauseStreak', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('runs out only after refusals outlast the longest pause measured', () => {
		vi.useFakeTimers();
		const streak = new RdPauseStreak();
		streak.note('paused');
		vi.advanceTimersByTime(RD_ADD_PAUSE_GIVE_UP_MS - 1);
		streak.note('paused');
		expect(streak.exhausted).toBe(false);
		vi.advanceTimersByTime(1);
		expect(streak.exhausted).toBe(true);
	});

	it('starts over on anything but a pause', () => {
		vi.useFakeTimers();
		const streak = new RdPauseStreak();
		streak.note('paused');
		vi.advanceTimersByTime(RD_ADD_PAUSE_GIVE_UP_MS);
		streak.note('failed');
		expect(streak.exhausted).toBe(false);
		streak.note('paused');
		vi.advanceTimersByTime(RD_ADD_PAUSE_GIVE_UP_MS - 1);
		expect(streak.exhausted).toBe(false);
	});
});
