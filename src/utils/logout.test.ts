import { beforeEach, describe, expect, it, vi } from 'vitest';

const clearMock = vi.fn();

vi.mock('@/torrent/db', () => ({
	__esModule: true,
	default: vi.fn().mockImplementation(() => ({
		clear: clearMock,
	})),
}));

import { handleLogout } from './logout';

describe('handleLogout', () => {
	beforeEach(() => {
		clearMock.mockReset();
		localStorage.clear();
	});

	it('clears only prefixed keys and reloads the route', async () => {
		localStorage.setItem('rd:key1', 'value');
		localStorage.setItem('other', 'keep');
		const router = { reload: vi.fn(), push: vi.fn() } as any;
		const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

		await handleLogout('rd:', router);

		expect(clearMock).toHaveBeenCalled();
		expect(localStorage.getItem('rd:key1')).toBeNull();
		expect(localStorage.getItem('other')).toBe('keep');
		expect(dispatchSpy).toHaveBeenCalledWith(expect.any(Event));
		expect(router.reload).toHaveBeenCalled();
	});

	it('clears all keys and navigates to /start when no prefix is provided', async () => {
		localStorage.setItem('foo', 'bar');
		const router = { reload: vi.fn(), push: vi.fn() } as any;

		await handleLogout(undefined, router);

		expect(localStorage.length).toBe(0);
		expect(router.push).toHaveBeenCalledWith('/start');
	});
});
