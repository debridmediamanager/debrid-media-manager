import summaries from '@/test/fixtures/wanted-summaries-2026-10-31.json';
import { describe, expect, it } from 'vitest';
import { wantedUnread } from './wantedUnread';

const now = Date.parse(summaries.capturedAt);
const hours = (h: number) => new Date(now - h * 3_600_000).toISOString();

describe('wantedUnread', () => {
	// Every sponsor's list as dmmdb held it on 2026-10-31 07:04 UTC, counts and
	// dates only.
	it('warns the sponsors whose lists no zurg had read in a day, and nobody else', () => {
		const warned = summaries.sponsors.map((s) => wantedUnread(s, now)).filter((w) => w);
		expect(warned.filter((w) => w!.never)).toHaveLength(37);
		expect(warned.filter((w) => !w!.never)).toHaveLength(2);
		const read = summaries.sponsors.filter(
			(s) => s.lastPolledAt && now - Date.parse(s.lastPolledAt) < 3_600_000
		);
		expect(read.length).toBeGreaterThan(50);
		expect(read.every((s) => wantedUnread(s, now) === null)).toBe(true);
	});

	it('gives a list its first day before warning', () => {
		expect(wantedUnread({ count: 3, since: hours(23), lastPolledAt: null }, now)).toBeNull();
		expect(wantedUnread({ count: 3, since: hours(25), lastPolledAt: null }, now)).toEqual({
			never: true,
		});
	});

	it('warns about a zurg that stopped reading, with when it last did', () => {
		expect(wantedUnread({ count: 3, since: hours(200), lastPolledAt: hours(30) }, now)).toEqual(
			{
				never: false,
				lastPolledAt: hours(30),
			}
		);
		expect(
			wantedUnread({ count: 3, since: hours(200), lastPolledAt: hours(2) }, now)
		).toBeNull();
	});

	it('says nothing about an empty list', () => {
		expect(wantedUnread({ count: 0, since: null, lastPolledAt: null }, now)).toBeNull();
	});
});
