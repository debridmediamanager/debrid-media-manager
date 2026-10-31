import limitReached from '@/test/fixtures/mdblist/legacy-lists-search-limit-reached.json';
import { describe, expect, it } from 'vitest';
import { lcg, shuffle } from './seededShuffle';

describe('seededShuffle', () => {
	it('lcg produces repeatable sequence for same seed', () => {
		const rng1 = lcg(123);
		const rng2 = lcg(123);
		const seq1 = [rng1(), rng1(), rng1()];
		const seq2 = [rng2(), rng2(), rng2()];
		expect(seq1).toEqual(seq2);
	});

	it('shuffle returns a permutation of input array', () => {
		const items = [1, 2, 3, 4, 5, 6];
		const shuffled = shuffle([...items], lcg(42));
		expect(shuffled.sort()).toEqual(items);
	});

	// An MDBList error body reached shuffle on 2026-10-30 and its loop never
	// ended, freezing each web replica until its health check killed it.
	it('returns a non-array untouched instead of looping forever', () => {
		expect(shuffle(limitReached as any, lcg(42))).toBe(limitReached);
	});
});
