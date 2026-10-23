import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	castToastOptions,
	genericToastOptions,
	libraryToastOptions,
	magnetToastOptions,
	searchToastOptions,
	toasterPosition,
} from './toastOptions';

const expectedOptions = {
	style: {
		borderRadius: '10px',
		background: 'rgba(255, 255, 0, 0.85)',
		color: '#000',
		fontSize: '1rem',
		padding: '0.1rem',
		// A toast over a button must not swallow the click meant for it.
		pointerEvents: 'none',
	},
};

describe('toastOptions', () => {
	it.each([
		['searchToastOptions', searchToastOptions],
		['libraryToastOptions', libraryToastOptions],
		['genericToastOptions', genericToastOptions],
		['magnetToastOptions', magnetToastOptions],
		['castToastOptions', castToastOptions],
	])('%s is exactly the standard toast style', (_, options) => {
		expect(options).toStrictEqual(expectedOptions);
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
