import { describe, expect, it } from 'vitest';
import { sortZurgResults } from './zurgSearchFilters';

const result = (title: string, fileSize: number) => ({
	title,
	fileSize,
	hash: title,
});

describe('Zurg search ordering', () => {
	it('sorts smallest releases first', () => {
		const results = [result('Large', 30), result('Small', 10)];
		expect(sortZurgResults(results, 'smallest')).toEqual([results[1], results[0]]);
	});

	it('keeps best releases largest first', () => {
		const results = [result('Large', 30), result('Small', 10)];
		expect(sortZurgResults(results, 'best')).toEqual(results);
	});
});
