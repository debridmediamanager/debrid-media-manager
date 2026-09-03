import { describe, expect, it } from 'vitest';
import { quickSearch, quickSearchLibrary } from './quickSearch';

describe('quickSearchLibrary', () => {
	const data: any[] = [
		{ id: 'rd:123', filename: 'Some Movie.mkv', hash: 'h1', serviceStatus: 'downloaded' },
		{ id: 'ad:456', filename: 'Show S01E01', hash: 'h2', serviceStatus: 'downloading' },
		{ id: 'tb:789', filename: 'Another.Thing', hash: 'h3', serviceStatus: 'queued' },
	];

	it('filters by filename regex or id/hash/status terms', () => {
		expect(quickSearchLibrary('Movie', data).length).toBe(1);
		expect(quickSearchLibrary('rd:', data).length).toBe(1);
		expect(quickSearchLibrary('123', data).length).toBe(1);
		expect(quickSearchLibrary('h2', data).length).toBe(1);
		expect(quickSearchLibrary('queued', data).length).toBe(1);
	});

	it('returns empty for invalid regex that matches nothing', () => {
		expect(quickSearchLibrary('(', data).length).toBe(0);
	});
});

describe('quickSearch', () => {
	const data: any[] = [
		{ title: 'Some Movie', hash: 'h1', videoCount: 2 },
		{ title: 'Show S01', hash: 'h2', videoCount: 10 },
		{ title: 'Another', hash: 'h3', videoCount: 0 },
	];

	it('supports videos:N, videos:<N, videos:>N filters', () => {
		expect(quickSearch('videos:2', data).length).toBe(1);
		expect(quickSearch('videos:<3', data).length).toBe(2);
		expect(quickSearch('videos:>3', data).length).toBe(1);
	});

	it('handles exclusion tokens and regex errors', () => {
		expect(quickSearch('Movie -Another', data).length).toBe(1);
		expect(quickSearch('(', data).length).toBe(0);
	});

	describe('availability filters', () => {
		const availability: any[] = [
			{ title: 'Cached in RD', hash: 'a1', rdAvailable: true },
			{ title: 'Cached in AD', hash: 'a2', adAvailable: true },
			{ title: 'Cached in TB', hash: 'a3', tbAvailable: true },
			{ title: 'Cached in RD and TB', hash: 'a4', rdAvailable: true, tbAvailable: true },
			{ title: 'Not cached anywhere', hash: 'a5' },
			{ title: 'Cached in PM', hash: 'a6', pmAvailable: true },
			{ title: 'Cached in OC', hash: 'a7', ocAvailable: true },
		];

		it('filters by a single service', () => {
			expect(quickSearch('is:rd', availability).map((r) => r.hash)).toEqual(['a1', 'a4']);
			expect(quickSearch('is:ad', availability).map((r) => r.hash)).toEqual(['a2']);
			expect(quickSearch('is:tb', availability).map((r) => r.hash)).toEqual(['a3', 'a4']);
			expect(quickSearch('is:pm', availability).map((r) => r.hash)).toEqual(['a6']);
			expect(quickSearch('is:oc', availability).map((r) => r.hash)).toEqual(['a7']);
		});

		it('filters by cached in any service and by uncached', () => {
			// Offcloud has to be in the aggregate too: Premiumize was left out of it
			// at first (97a28e0f) and an is:cached filter then hid rows that were
			// perfectly playable.
			expect(quickSearch('is:cached', availability).map((r) => r.hash)).toEqual([
				'a1',
				'a2',
				'a3',
				'a4',
				'a6',
				'a7',
			]);
			expect(quickSearch('is:uncached', availability).map((r) => r.hash)).toEqual(['a5']);
		});

		it('combines with other terms and supports exclusion', () => {
			expect(quickSearch('is:rd tb', availability).map((r) => r.hash)).toEqual(['a4']);
			expect(quickSearch('-is:rd', availability).map((r) => r.hash)).toEqual([
				'a2',
				'a3',
				'a5',
				'a6',
				'a7',
			]);
		});

		it('matches nothing for an unknown service', () => {
			expect(quickSearch('is:xx', availability).length).toBe(0);
		});

		it('has no is:dl token, and a Debrid-Link row is never counted as cached', () => {
			// Debrid-Link publishes no cache probe, so there is nothing an
			// `is:dl` pill could filter on and no flag `is:cached` could read. It
			// is `is:xx` as far as this function is concerned, on purpose - a
			// token backed by a permanently-false field would hide every row from
			// a Debrid-Link user who filtered by it.
			const withDl = [...availability, { title: 'In DL', hash: 'a8', dlAvailable: true }];

			expect(quickSearch('is:dl', withDl).length).toBe(0);
			expect(quickSearch('is:cached', withDl).map((r) => r.hash)).not.toContain('a8');
			expect(quickSearch('is:uncached', withDl).map((r) => r.hash)).toEqual(['a5', 'a8']);
		});
	});
});
