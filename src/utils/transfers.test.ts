import { describe, expect, it } from 'vitest';
import {
	isTerminal,
	ORIGIN_LABELS,
	ORIGIN_STYLES,
	originOf,
	toEntries,
	TransferOrigin,
} from './transfers';

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

describe('originOf', () => {
	it('names the provider a debrid job actually used', () => {
		// The row used to say "TB → RD" whatever served it, which was wrong for
		// every AllDebrid transfer — and dmm sends both keys, so those are real.
		expect(originOf('debrid', 'torbox')).toBe('torbox');
		expect(originOf('debrid', 'alldebrid')).toBe('alldebrid');
		expect(originOf('debrid', 'qbit')).toBe('qbit');
	});

	it('says Cache while the service has not picked one yet', () => {
		// A job is queued or still probing: the answer is genuinely unknown, and
		// naming either provider would be a guess the user would act on.
		expect(originOf('debrid', null)).toBe('cache');
		expect(originOf('debrid', undefined)).toBe('cache');
	});

	it('ignores a source it does not recognise rather than rendering it raw', () => {
		expect(originOf('debrid', 'premiumize')).toBe('cache');
		expect(originOf('debrid', '')).toBe('cache');
	});

	it('always calls an nzb2rd job Usenet, whatever the field says', () => {
		expect(originOf('nzb2rd', undefined)).toBe('usenet');
		expect(originOf('nzb2rd', 'torbox')).toBe('usenet');
	});

	it('gives every origin a label and a chip style', () => {
		for (const origin of Object.keys(ORIGIN_LABELS) as TransferOrigin[]) {
			expect(ORIGIN_LABELS[origin]).toBeTruthy();
			expect(ORIGIN_STYLES[origin]).toBeTruthy();
		}
	});
});
