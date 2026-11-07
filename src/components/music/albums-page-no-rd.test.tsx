import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

const routerMock = { query: {}, asPath: '/music', push: vi.fn(), replace: vi.fn(), back: vi.fn() };

vi.mock('next/router', () => ({ __esModule: true, useRouter: () => routerMock }));
vi.mock('next/head', () => ({
	__esModule: true,
	default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
// Signed in to DMM with another service only (TorBox here, Reddit 1xp8m5s): no RD token.
vi.mock('@/hooks/auth', () => ({
	useRealDebridAccessToken: () => [null, false, false],
	useRealDebrid: () => ({ user: null }),
}));

import AlbumsPage from '@/pages/albums/[[...slug]]';

describe('Music without a Real-Debrid account', () => {
	it('says Music needs Real-Debrid instead of dropping the user on the RD sign-in page', () => {
		render(<AlbumsPage />);

		expect(routerMock.push).not.toHaveBeenCalled();
		expect(screen.getByText('Music plays through Real-Debrid')).toBeTruthy();
		expect(screen.getByRole('link', { name: 'Connect Real-Debrid' }).getAttribute('href')).toBe(
			'/realdebrid/login?redirect=/music'
		);
	});
});
