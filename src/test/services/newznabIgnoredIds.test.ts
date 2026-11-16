import { withoutIgnoredIds } from '@/services/newznab/ignoredIds';
import { describe, expect, it } from 'vitest';
import answers from '../fixtures/newznab/tv-id-search-answers-2026-11-15.json';

const ignored = answers.ignoredId.results;

describe('withoutIgnoredIds', () => {
	it('drops an upstream that answered an id search with every show of that episode', () => {
		expect(ignored.some((r) => r.title.startsWith('Lets.Go.S01E26'))).toBe(true);
		expect(withoutIgnoredIds(ignored)).toEqual([]);
	});

	it.each(Object.entries(answers.kept))(
		'keeps the answer for %s however its posts spell the show',
		(_label, { results }) => {
			expect(withoutIgnoredIds(results)).toEqual(results);
		}
	);

	it('keeps the other upstreams of the same search', () => {
		const other = answers.kept['peaky-blinders'].results;
		expect(withoutIgnoredIds([...ignored, ...other])).toEqual(other);
	});
});
