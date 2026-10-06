import corpus from '@/test/fixtures/titleMatcher/scrapedtrue-pairs-2026-10-06.json';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAllPossibleTitles, meetsTitleConditions } from './checks';
import { cleanSearchQuery, liteCleanSearchQuery } from './search';

type Pair = (typeof corpus.pairs)[number];

// The titles a cleaner hands the matcher for a page, derived the way
// grabMovieMetadata and grabTvMetadata derive them: always lowercase.
function pageTitles(pair: Pair): string[] {
	const clean = cleanSearchQuery(pair.primaryTitle);
	const lite = liteCleanSearchQuery(pair.primaryTitle);
	const original =
		pair.originalTitle && pair.originalTitle !== pair.primaryTitle
			? pair.originalTitle.toLowerCase()
			: undefined;
	return getAllPossibleTitles([clean, original, lite !== clean ? lite : undefined]);
}

function keeps(pair: Pair, release: string): boolean {
	const years = pair.year ? [pair.year] : [];
	return pageTitles(pair).some((title) => meetsTitleConditions(title, years, release));
}

const describePair = (pair: Pair) => `${pair.page} ${pair.primaryTitle} <- ${pair.release}`;

describe('meetsTitleConditions on real production pages', () => {
	beforeEach(() => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
	});

	it('rejects Banned! The Mary Whitehouse Story on the Filth page in any letter case', () => {
		// Card 229: lowercase passed and capitalised failed, because the
		// character ratio counted each capital as an edit and "filth" for
		// "banned" fitted inside what was left.
		const target = cleanSearchQuery('Filth: The Mary Whitehouse Story');
		for (const release of [
			'Banned.The.Mary.Whitehouse.Story.S01E02.1080p.HDTV.H264-DARKFLiX',
			'banned.the.mary.whitehouse.story.s01e02.1080p.hdtv.h264-darkflix',
		]) {
			expect(meetsTitleConditions(target, ['2008'], release), release).toBe(false);
			expect(meetsTitleConditions(target, [], release), release).toBe(false);
		}
	});

	it('gives a release the same answer whatever its letter case', () => {
		const disagreements = corpus.pairs
			.filter((pair) => keeps(pair, pair.release) !== keeps(pair, pair.release.toLowerCase()))
			.map(describePair);
		expect(disagreements).toEqual([]);
	});

	it('keeps the releases of the page own title', () => {
		const lost = corpus.pairs
			.filter((pair) => pair.label === 'keep')
			.filter(
				(pair) => !keeps(pair, pair.release) || !keeps(pair, pair.release.toLowerCase())
			)
			.map(describePair);
		expect(lost).toEqual([]);
	});

	it('rejects releases of another title', () => {
		const accepted = corpus.pairs
			.filter((pair) => pair.label === 'reject')
			.filter((pair) => keeps(pair, pair.release) || keeps(pair, pair.release.toLowerCase()))
			.map(describePair);
		expect(accepted).toEqual([]);
	});
});
