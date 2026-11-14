import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import simklList200 from '../fixtures/simkl/list-items-200.json';

vi.mock('@/hooks/auth', () => ({
	useSimklAuth: () => ({
		cacheKey: 'k',
		user: { user: { name: 'testweek' }, account: { id: 8199460, type: 'vip' } },
		error: null,
		loading: false,
		hasAuth: true,
	}),
}));
vi.mock('@/hooks/useSponsor', () => ({
	useSponsor: () => ({ isSponsor: true }),
	sponsorHeaders: () => ({ 'x-dmm-sponsor': 'token' }),
}));
vi.mock('@/services/simkl', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/services/simkl')>()),
	getSimklList: vi.fn(async () => simklList200),
}));
vi.mock('@/components/poster', () => ({ default: () => null }));
vi.mock('next/router', () => ({
	useRouter: () => ({ isReady: true, query: { id: '216324' }, push: vi.fn() }),
}));
vi.mock('next/head', () => ({ default: () => null }));
vi.mock('react-hot-toast', () => ({
	Toaster: () => null,
	default: { success: vi.fn(), error: vi.fn() },
}));

import SimklListPage from '@/pages/simkl/list/[id]';

beforeEach(() => {
	localStorage.clear();
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => new Response(JSON.stringify({ name: 'x', count: 0, added: 0 })))
	);
});

describe('a Simkl list page', () => {
	it("follows the list on the wanted page by its owner's simkl.com page", async () => {
		render(<SimklListPage />);
		fireEvent.click(await screen.findByRole('button', { name: /Follow with Want/ }));
		await waitFor(() => expect(fetch).toHaveBeenCalled());
		const [url, init] = vi.mocked(fetch).mock.calls[0];
		expect(url).toBe('/api/wanted/lists');
		expect(JSON.parse(String((init as RequestInit).body))).toEqual({
			url: 'https://simkl.com/8199460/list/216324',
		});
	});
});
