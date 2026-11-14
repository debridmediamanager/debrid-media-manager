import { render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const castTokenMock = vi.fn();

vi.mock('@/hooks/castToken', () => ({
	__esModule: true,
	useCastToken: (...args: unknown[]) => castTokenMock(...args),
}));

vi.mock('@/utils/withAuth', () => ({
	__esModule: true,
	withAuth: (component: any) => component,
}));

vi.mock('next/link', () => ({
	__esModule: true,
	default: ({ href, children, ...rest }: any) => (
		<a href={typeof href === 'string' ? href : String(href)} {...rest}>
			{children}
		</a>
	),
}));

vi.mock('next/head', () => ({
	__esModule: true,
	default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('next/image', () => ({
	__esModule: true,
	default: ({ alt }: { alt: string }) => <img alt={alt} data-testid="stremio-image" />,
}));

import { StremioPage } from '@/pages/stremio';

describe('StremioPage', () => {
	beforeEach(() => {
		castTokenMock.mockReset();
		localStorage.clear();
	});

	it('enrols in DMM Cast: this is the page that creates the profile', () => {
		castTokenMock.mockReturnValue(undefined);
		render(<StremioPage />);
		expect(castTokenMock).toHaveBeenCalledWith({ enroll: true });
	});

	it('shows an error message when user is not logged in with RD', () => {
		castTokenMock.mockReturnValue(undefined);
		render(<StremioPage />);
		expect(screen.getByText(/Real-Debrid Required/i)).toBeInTheDocument();
		expect(screen.getByText(/You must be logged in with Real-Debrid/i)).toBeInTheDocument();
		expect(screen.getByRole('link', { name: /Login with Real-Debrid/i })).toBeInTheDocument();
	});

	// `/realdebrid/login` has taken a pasted API key since 18b32d04, and that
	// path stores only `rd:accessToken`. Gating this page on the full OAuth
	// quad left those users in a loop: the page demanded a login, the login
	// saved their key and returned them home, and the page demanded it again.
	it('renders for a session holding only a pasted API key', () => {
		localStorage.setItem('rd:accessToken', 'apikey123');
		castTokenMock.mockReturnValue('token123');
		render(<StremioPage />);

		expect(screen.queryByText(/Real-Debrid Required/i)).not.toBeInTheDocument();
		expect(screen.getByText(/api\/stremio\/token123\/manifest\.json/i)).toBeInTheDocument();
	});

	it('sends the login link back to this page instead of home', () => {
		castTokenMock.mockReturnValue(undefined);
		render(<StremioPage />);
		expect(screen.getByRole('link', { name: /Login with Real-Debrid/i })).toHaveAttribute(
			'href',
			'/realdebrid/login?redirect=%2Fstremio'
		);
	});

	it('shows a loading state until the cast token is ready when user has RD credentials', () => {
		localStorage.setItem('rd:clientId', 'client123');
		localStorage.setItem('rd:clientSecret', 'secret123');
		localStorage.setItem('rd:refreshToken', 'refresh123');
		localStorage.setItem('rd:accessToken', 'access123');
		castTokenMock.mockReturnValue(undefined);
		render(<StremioPage />);
		expect(screen.getByText(/Debrid Media Manager is loading/i)).toBeInTheDocument();
	});

	it('renders install links when a cast token is available', () => {
		localStorage.setItem('rd:clientId', 'client123');
		localStorage.setItem('rd:clientSecret', 'secret123');
		localStorage.setItem('rd:refreshToken', 'refresh123');
		localStorage.setItem('rd:accessToken', 'access123');
		castTokenMock.mockReturnValue('token123');
		render(<StremioPage />);

		const installLinks = screen.getAllByRole('link', { name: /^install$/i });
		const installLink = installLinks.find((link) =>
			link.getAttribute('href')?.includes('/manifest.json')
		);
		expect(installLink).toBeTruthy();
		const installHref = installLink?.getAttribute('href') || '';
		expect(installHref).toContain('stremio://localhost');
		expect(installHref).toContain('/api/stremio/token123/manifest.json');

		const webLinks = screen.getAllByRole('link', { name: /install \(web\)/i });
		const webLink = webLinks.find((link) =>
			decodeURIComponent(link.getAttribute('href') || '').includes('/manifest.json')
		);
		expect(webLink).toBeTruthy();
		const webHref = webLink?.getAttribute('href') || '';
		expect(decodeURIComponent(webHref)).toContain('/api/stremio/token123/manifest.json');

		expect(screen.getByText(/Private to your account: never share it/i)).toBeInTheDocument();
		expect(screen.getByText(/api\/stremio\/token123\/manifest\.json/i)).toBeInTheDocument();
	});

	// Stremio Web's search bar only searches: a pasted addon address does nothing
	// there (guide testing, 2026-11-14). Addons → Add addon installs it.
	it('tells people to paste the address under Addons, not in the search bar', () => {
		localStorage.setItem('rd:accessToken', 'access123');
		castTokenMock.mockReturnValue('token123');
		render(<StremioPage />);

		const hint = screen.getByText(/Private to your account: never share it/i);
		expect(hint).toHaveTextContent(/Addons → Add addon/);
		expect(hint).not.toHaveTextContent(/search bar/i);
	});
});
