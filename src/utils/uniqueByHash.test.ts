import { describe, expect, it } from 'vitest';
import { uniqueByHash } from './uniqueByHash';

describe('uniqueByHash', () => {
	it('keeps the first row for each hash, in order', () => {
		const rows = [
			{ hash: 'a', n: 1 },
			{ hash: 'b', n: 2 },
			{ hash: 'a', n: 3 },
			{ hash: 'c', n: 4 },
			{ hash: 'b', n: 5 },
		];
		expect(uniqueByHash(rows).map((r) => r.n)).toEqual([1, 2, 4]);
	});
});
