import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	castToastOptions,
	genericToastOptions,
	libraryToastOptions,
	magnetToastOptions,
	searchToastOptions,
	toasterPosition,
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

describe('toasterPosition', () => {
	afterEach(() => vi.unstubAllGlobals());
	const stubWidth = (phone: boolean) =>
		vi.stubGlobal('matchMedia', (query: string) => ({ matches: phone, media: query }));

	// Along the bottom of a phone the toasts sat on the result buttons.
	it('puts toasts at the top on phones', () => {
		stubWidth(true);
		expect(toasterPosition()).toBe('top-center');
	});

	it('keeps toasts bottom-right on wider screens', () => {
		stubWidth(false);
		expect(toasterPosition()).toBe('bottom-right');
	});
});
