import type * as SimklService from '@/services/simkl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const clearMock = vi.fn();
const { logoutSimklMock } = vi.hoisted(() => ({ logoutSimklMock: vi.fn() }));

vi.mock('@/services/simkl', async (importOriginal) => ({
	...(await importOriginal<typeof SimklService>()),
	logoutSimkl: logoutSimklMock,
}));

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
		logoutSimklMock.mockReset();
		logoutSimklMock.mockResolvedValue(undefined);
		localStorage.clear();
	});

	it('clears only prefixed keys and reloads the route', async () => {
		localStorage.setItem('rd:key1', 'value');
		localStorage.setItem('other', 'keep');
		const router = { reload: vi.fn(), push: vi.fn() };

		await handleLogout('rd:', router);

		expect(localStorage.getItem('rd:key1')).toBeNull();
		expect(localStorage.getItem('other')).toBe('keep');
		expect(router.reload).toHaveBeenCalled();
	});

	it('clears all keys and navigates to /start when no prefix is provided', async () => {
		localStorage.setItem('foo', 'bar');
		const router = { reload: vi.fn(), push: vi.fn() };

		await handleLogout(undefined, router);

		expect(localStorage.getItem('foo')).toBeNull();
		expect(router.push).toHaveBeenCalledWith('/start');
	});
	it('preserves other credentials and the current route when server sign-out fails', async () => {
		localStorage.setItem('rd:accessToken', 'keep-rd-account');
		localStorage.setItem('dmm:guest', 'true');
		const unavailable = new Error('Session store unavailable');
		logoutSimklMock.mockRejectedValue(unavailable);
		const router = { reload: vi.fn(), push: vi.fn() };

		await expect(handleLogout(undefined, router)).rejects.toBe(unavailable);

		expect(localStorage.getItem('rd:accessToken')).toBe('keep-rd-account');
		expect(localStorage.getItem('dmm:guest')).toBe('true');
		expect(router.push).not.toHaveBeenCalled();
		expect(router.reload).not.toHaveBeenCalled();
	});
});
