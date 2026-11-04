import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	BOOT_GUARD_FALLBACK_ID,
	BOOT_GUARD_RELOAD_KEY,
	BOOT_GUARD_SCRIPT,
	BOOT_GUARD_TIMEOUT_MS,
} from '@/utils/bootGuard';

// Fizzy #587: the guard runs before the bundle, so it is exercised as the raw script text.
describe('boot guard script', () => {
	let reload: ReturnType<typeof vi.fn>;
	let added: Array<[string, EventListener, boolean]>;

	const run = () => {
		const fakeWindow = {
			addEventListener: (type: string, fn: EventListener, capture: boolean) =>
				added.push([type, fn, capture]),
			__dmmHydrated: undefined as boolean | undefined,
		};
		new Function('window', 'location', BOOT_GUARD_SCRIPT)(fakeWindow, { reload });
		return fakeWindow;
	};
	const failScript = (src: string) => {
		const el = document.createElement('script');
		el.src = src;
		for (const [type, fn, capture] of added) {
			expect(capture).toBe(true);
			if (type === 'error') fn({ target: el } as unknown as Event);
		}
	};

	beforeEach(() => {
		vi.useFakeTimers();
		reload = vi.fn();
		added = [];
		sessionStorage.clear();
		document.body.innerHTML = '';
	});
	afterEach(() => vi.useRealTimers());

	it('reloads once when a /_next/static script fails, then offers a reload button', () => {
		run();
		failScript('https://debridmediamanager.com/_next/static/chunks/main-cc85b1cc008a5376.js');
		expect(reload).toHaveBeenCalledTimes(1);
		expect(sessionStorage.getItem(BOOT_GUARD_RELOAD_KEY)).toBe('1');

		// The reloaded page fails again: no loop, show the way out instead.
		run();
		failScript(
			'https://debridmediamanager.com/_next/static/chunks/pages/index-591c7ff653ad509c.js'
		);
		expect(reload).toHaveBeenCalledTimes(1);
		const button = document.querySelector(`#${BOOT_GUARD_FALLBACK_ID} button`) as HTMLElement;
		expect(button.textContent).toBe('Reload');
		button.click();
		expect(reload).toHaveBeenCalledTimes(2);
		expect(sessionStorage.getItem(BOOT_GUARD_RELOAD_KEY)).toBeNull();
	});

	it('ignores failures of other scripts and failures after hydration', () => {
		const w = run();
		failScript('https://example.com/analytics.js');
		w.__dmmHydrated = true;
		failScript('https://debridmediamanager.com/_next/static/chunks/late-chunk.js');
		vi.advanceTimersByTime(BOOT_GUARD_TIMEOUT_MS);
		expect(reload).not.toHaveBeenCalled();
		expect(document.getElementById(BOOT_GUARD_FALLBACK_ID)).toBeNull();
	});

	it('shows the reload button when the app never hydrates', () => {
		run();
		vi.advanceTimersByTime(BOOT_GUARD_TIMEOUT_MS - 1);
		expect(document.getElementById(BOOT_GUARD_FALLBACK_ID)).toBeNull();
		vi.advanceTimersByTime(1);
		expect(document.getElementById(BOOT_GUARD_FALLBACK_ID)).not.toBeNull();
		expect(reload).not.toHaveBeenCalled();
	});
});
