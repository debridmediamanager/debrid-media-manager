import { describe, expect, it } from 'vitest';
import { isTerminal, toEntries } from './transfers';

const debridJob = {
	id: 'd1',
	hash: 'a'.repeat(40),
	imdbId: 'tt1111111',
	title: 'TB job',
	returnPath: '/movie/tt1111111',
	createdAt: 100,
};

const usenetJob = {
	id: 'n1',
	releaseId: 'rel-1',
	imdbId: 'tt2222222',
	title: 'Usenet job',
	returnPath: '/show/tt2222222/2',
	createdAt: 200,
};

describe('toEntries', () => {
	it('merges both transfer kinds newest-first', () => {
		const entries = toEntries([debridJob], [usenetJob]);
		expect(entries.map((e) => e.id)).toEqual(['n1', 'd1']);
		expect(entries.map((e) => e.source)).toEqual(['nzb2rd', 'debrid']);
	});

	it('carries the release id on Usenet rows only — polls and cancels need it', () => {
		const [usenet, debrid] = toEntries([debridJob], [usenetJob]);
		expect(usenet.releaseId).toBe('rel-1');
		expect(debrid.releaseId).toBeUndefined();
	});

	it('handles either list being empty', () => {
		expect(toEntries([], [])).toEqual([]);
		expect(toEntries([debridJob], [])).toHaveLength(1);
		expect(toEntries([], [usenetJob])).toHaveLength(1);
	});
});

describe('isTerminal', () => {
	it('treats completed and failed as terminal for both sources', () => {
		for (const source of ['debrid', 'nzb2rd'] as const) {
			expect(isTerminal(source, 'completed')).toBe(true);
			expect(isTerminal(source, 'failed')).toBe(true);
			expect(isTerminal(source, 'pending')).toBe(false);
		}
	});

	it("keeps polling nzb2rd's own stages, which the TB → RD flow never reports", () => {
		for (const status of ['probing', 'fetching', 'unpacking', 'hashing']) {
			expect(isTerminal('nzb2rd', status)).toBe(false);
		}
	});
});
