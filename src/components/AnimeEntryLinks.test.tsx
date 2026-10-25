import { describe, expect, it } from 'vitest';
import { sharedTitlePrefix } from './AnimeEntryLinks';

describe('sharedTitlePrefix', () => {
	// /api/anime/franchise?anidbid=18884 on production, 2026-10-25.
	const slime = [
		'Tensei Shitara Slime Datta Ken',
		'Tensei Shitara Slime Datta Ken (2019)',
		'Tensei Shitara Slime Datta Ken (2021)',
		'Tensei Shitara Slime Datta Ken (2021 Dai 2 Bu)',
		'Tensei Shitara Slime Datta Ken (2024)',
		'Tensei Shitara Slime Datta Ken: Coleus no Yume',
		'Tensei Shitara Slime Datta Ken Dai 4 Ki',
	];

	it('finds the whole words every title starts with', () => {
		expect(sharedTitlePrefix(slime)).toBe('Tensei Shitara Slime Datta Ken');
		expect(sharedTitlePrefix(['Sousou no Frieren', 'Sousou no Frieren (2026)'])).toBe(
			'Sousou no Frieren'
		);
	});

	it('never cuts a word in half', () => {
		expect(sharedTitlePrefix(['Honzuki no Gekokujou', 'Honzuki no Gekijou'])).toBe(
			'Honzuki no'
		);
		expect(sharedTitlePrefix(['Naruto', 'Narutaru'])).toBe('');
	});

	it('has nothing to share with one title', () => {
		expect(sharedTitlePrefix(['Sousou no Frieren'])).toBe('');
	});
});
