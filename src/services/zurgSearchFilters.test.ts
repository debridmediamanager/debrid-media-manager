import { describe, expect, it } from 'vitest';
import { filterZurgResults, sortZurgResults } from './zurgSearchFilters';

const result = (title: string, fileSize: number) => ({
	title,
	fileSize,
	hash: title,
});

describe('Zurg search filters', () => {
	it('supports smallest and sorts ascending', () => {
		const results = [result('Large.2160p.WEB-DL', 30), result('Small.1080p.WEBRip', 10)];

		expect(sortZurgResults(filterZurgResults(results, 'smallest', 'any'), 'smallest')).toEqual([
			results[1],
			results[0],
		]);
	});

	it('applies quality releases after resolution filtering', () => {
		const results = [
			result('Movie.2160p.WEB-DL', 20),
			result('Movie.2024.x264', 25),
			result('Movie.1080p.BluRay', 15),
		];

		const filtered = filterZurgResults(results, 'best', 'quality_releases');
		expect(filtered.map((item) => item.title)).toEqual([
			'Movie.2160p.WEB-DL',
			'Movie.1080p.BluRay',
		]);
	});

	it('keeps existing best behavior when no profile is requested', () => {
		const results = [result('Large.2160p', 30), result('Small.1080p', 10)];
		expect(sortZurgResults(filterZurgResults(results, 'best', 'any'), 'best')).toEqual(results);
	});
});
