import { afterEach, describe, expect, it, vi } from 'vitest';
import { toasterPosition } from './toastOptions';

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
