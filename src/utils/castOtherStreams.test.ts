import { describe, expect, it } from 'vitest';
import { biggestOtherStreams } from './castOtherStreams';

const cast = (hash: string, size: number) => ({ hash, size });
const release = (hash: string, sizeMb: number) => ({ hash, sizeMb });

describe('biggestOtherStreams', () => {
	it('lets a bigger cached release take a slot from a smaller cast', () => {
		const picks = biggestOtherStreams(
			[cast('a', 84830), cast('b', 41790)],
			[release('tmt', 92424), release('small', 4000)],
			3
		);
		expect(picks.map((p) => p.cast?.hash ?? p.trove?.hash)).toEqual(['tmt', 'a', 'b']);
	});

	it('keeps the cast ahead of a release of the same size', () => {
		const picks = biggestOtherStreams([cast('c', 84159)], [release('r', 84159)], 2);
		expect(picks[0].cast?.hash).toBe('c');
		expect(picks[1].trove?.hash).toBe('r');
	});

	it('offers nothing for a limit of zero or less', () => {
		expect(biggestOtherStreams([cast('a', 1)], [release('r', 2)], 0)).toEqual([]);
		expect(biggestOtherStreams([cast('a', 1)], [release('r', 2)], -3)).toEqual([]);
	});
});
