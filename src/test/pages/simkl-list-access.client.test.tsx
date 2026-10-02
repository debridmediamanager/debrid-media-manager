import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Do not mock withAuth: this regression covers the actual page export for a
// visitor who has neither a debrid credential nor guest-mode state.
vi.mock('@/hooks/auth', () => ({
	useSimklAuth: () => ({
		cacheKey: null,
		user: null,
		error: null,
		loading: false,
		hasAuth: false,
	}),
	useRealDebridAccessToken: () => [null, false, false],
	useAllDebridApiKey: () => null,
}));
vi.mock('@/utils/guestMode', () => ({ useGuestMode: () => false, disableGuestMode: vi.fn() }));
vi.mock('@/components/Logo', () => ({ Logo: () => null }));
vi.mock('next/router', () => ({
	useRouter: () => ({
		isReady: true,
		query: { id: '216324' },
		pathname: '/simkl/mylists',
		asPath: '/simkl/mylists',
		push: vi.fn(),
	}),
}));
vi.mock('next/head', () => ({ default: () => null }));
vi.mock('react-hot-toast', () => ({ Toaster: () => null, default: { error: vi.fn() } }));

import SimklListPage from '@/pages/simkl/list/[id]';
import SimklMyLists from '@/pages/simkl/mylists';

beforeEach(() => {
	localStorage.clear();
});

describe('SIMKL lists without a debrid account', () => {
	it('opens the custom-list library sign-in instead of requiring debrid onboarding', async () => {
		render(<SimklMyLists />);
		expect(await screen.findByRole('button', { name: 'Simkl Login' })).toBeInTheDocument();
	});

	it('opens a direct list’s SIMKL sign-in instead of requiring debrid onboarding', async () => {
		render(<SimklListPage />);
		expect(await screen.findByRole('button', { name: 'Simkl Login' })).toBeInTheDocument();
	});
});
