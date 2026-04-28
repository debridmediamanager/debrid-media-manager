import { describe, expect, it } from 'vitest';
import {
	castToastOptions,
	genericToastOptions,
	libraryToastOptions,
	magnetToastOptions,
	searchToastOptions,
} from './toastOptions';

const expectedStyle = {
	borderRadius: '10px',
	background: 'rgba(255, 255, 0, 0.85)',
	color: '#000',
	fontSize: '1rem',
	padding: '0.1rem',
};

describe('toastOptions', () => {
	it.each([
		['searchToastOptions', searchToastOptions],
		['libraryToastOptions', libraryToastOptions],
		['genericToastOptions', genericToastOptions],
		['magnetToastOptions', magnetToastOptions],
		['castToastOptions', castToastOptions],
	])('%s has the standard toast style', (_, options) => {
		expect(options.style).toEqual(expectedStyle);
	});

	it('all options share the same style structure', () => {
		const all = [
			searchToastOptions,
			libraryToastOptions,
			genericToastOptions,
			magnetToastOptions,
			castToastOptions,
		];

		for (const opt of all) {
			expect(opt).toHaveProperty('style');
			expect(opt.style).toHaveProperty('borderRadius');
			expect(opt.style).toHaveProperty('background');
			expect(opt.style).toHaveProperty('color');
			expect(opt.style).toHaveProperty('fontSize');
			expect(opt.style).toHaveProperty('padding');
		}
	});
});
