import { describe, expect, it } from 'vitest';
import { blocksFor, countCreditedSends, DAYS_PER_BLOCK, extendEarned } from './fulfillerRewards';

const DAY = 24 * 60 * 60 * 1000;

describe('countCreditedSends', () => {
	it('counts one send per asker per UTC day', () => {
		expect(
			countCreditedSends([
				{ requesterId: 'a', fulfilledAt: '2026-10-20T01:00:00Z' },
				{ requesterId: 'a', fulfilledAt: '2026-10-20T23:00:00Z' },
				{ requesterId: 'a', fulfilledAt: '2026-10-21T00:30:00Z' },
				{ requesterId: 'b', fulfilledAt: '2026-10-20T05:00:00Z' },
			])
		).toBe(3);
	});

	// A second Real-Debrid account filing and fulfilling its own asks all day
	// earns one send a day, not one per ask.
	it('gives one asker filing all day a single send', () => {
		const rows = Array.from({ length: 30 }, (_, i) => ({
			requesterId: 'alt',
			fulfilledAt: new Date(Date.UTC(2026, 9, 20, 0, i)),
		}));
		expect(countCreditedSends(rows)).toBe(1);
	});

	it('skips a send with no landing time', () => {
		expect(countCreditedSends([{ requesterId: 'a', fulfilledAt: null }])).toBe(0);
	});
});

describe('blocksFor', () => {
	it.each([
		[0, 0],
		[9, 0],
		[10, 1],
		[29, 2],
	])('%i credited sends buy %i blocks', (sends, blocks) => {
		expect(blocksFor(sends)).toBe(blocks);
	});
});

describe('extendEarned', () => {
	const now = new Date('2026-10-24T00:00:00Z');

	it('starts from now when nothing is left', () => {
		expect(extendEarned(null, 1, now).getTime()).toBe(now.getTime() + DAYS_PER_BLOCK * DAY);
		const lapsed = new Date('2026-10-01T00:00:00Z');
		expect(extendEarned(lapsed, 1, now).getTime()).toBe(now.getTime() + DAYS_PER_BLOCK * DAY);
	});

	it('stacks on time still left', () => {
		const left = new Date('2026-10-27T00:00:00Z');
		expect(extendEarned(left, 2, now).getTime()).toBe(
			left.getTime() + 2 * DAYS_PER_BLOCK * DAY
		);
	});
});
