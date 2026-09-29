import { describe, expect, it } from 'vitest';
import { bucketOf, summarizeCoverage, type StreamedTitle } from './searchCoverage';

// Ids and user counts from the `Cast` table on 2026-09-29, before search's
// title types were fixed; `searchable` is what search answered then.
const title = (
	imdbId: string,
	titleType: string | null,
	users: number,
	searchable: boolean,
	isAdult = false
): StreamedTitle => ({ imdbId, titleType, users, searchable, isAdult });

const futuramaEra = [
	title('tt0149460', 'tvSeries', 400, true), // Futurama
	title('tt41368989', 'tvSpecial', 35, false), // Finding Harry
	title('tt0108598', 'short', 29, false), // The Wrong Trousers
	title('tt26748649', null, 96, false), // High Potential, as Cinemeta ids it
	title('tt1630885', 'tvEpisode', 3, false),
	title('tt0377952', 'videoGame', 2, false),
	title('tt0259297', 'video', 6, false, true),
];

describe('bucketOf', () => {
	it.each([
		[futuramaEra[0], 'searchable'],
		[futuramaEra[1], 'unsearchable'],
		[futuramaEra[2], 'unsearchable'],
		[futuramaEra[3], 'not in IMDb dump'],
		[futuramaEra[4], 'excluded on purpose'],
		[futuramaEra[5], 'excluded on purpose'],
		[futuramaEra[6], 'excluded on purpose'],
	])('files %o as %s', (t, bucket) => {
		expect(bucketOf(t)).toBe(bucket);
	});
});

describe('summarizeCoverage', () => {
	it('alerts on each movie or show title enough users streamed but search cannot find', () => {
		const report = summarizeCoverage(futuramaEra);

		expect(report.alerts).toContain(
			'tt41368989 (tvSpecial) was streamed by 35 users but search cannot find it'
		);
		expect(report.alerts).toContain(
			'tt0108598 (short) was streamed by 29 users but search cannot find it'
		);
	});

	it('reports but never alerts on titles the IMDb dump lacks or search leaves out on purpose', () => {
		const report = summarizeCoverage(futuramaEra);

		expect(report.top['not in IMDb dump'].map((t) => t.imdbId)).toEqual(['tt26748649']);
		expect(report.alerts.join(' ')).not.toMatch(/tt26748649|tt1630885|tt0377952|tt0259297/);
	});

	it('counts the share over titles that have a page', () => {
		const report = summarizeCoverage(futuramaEra, { minUsers: 1000, minShare: 0.95 });

		expect(report.share).toBeCloseTo(400 / 464);
		expect(report.alerts).toEqual(['search finds 86.2% of streamed titles, under 95%']);
	});

	it('stays quiet when search finds what users stream', () => {
		const report = summarizeCoverage([
			title('tt0149460', 'tvSeries', 400, true),
			title('tt0471711', 'video', 40, true),
			title('tt0350345', 'movie', 2, false), // Drowning (1995), no ratings row
		]);

		expect(report.alerts).toEqual([]);
		expect(report.top.unsearchable.map((t) => t.imdbId)).toEqual(['tt0350345']);
	});

	it('lists the fifteen biggest misses, most users first', () => {
		const many = Array.from({ length: 20 }, (_, i) =>
			title(`tt${1000 + i}`, 'movie', i + 1, false)
		);
		const report = summarizeCoverage(many);

		expect(report.top.unsearchable).toHaveLength(15);
		expect(report.top.unsearchable[0]).toMatchObject({ imdbId: 'tt1019', users: 20 });
	});
});
