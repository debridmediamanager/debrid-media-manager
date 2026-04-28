import { render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const castTokenMock = vi.fn();

vi.mock('@/hooks/castToken', () => ({
	__esModule: true,
	useCastToken: () => castTokenMock(),
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

	it('shows an error message when user is not logged in with RD', () => {
		castTokenMock.mockReturnValue(undefined);
		render(<StremioPage />);
		expect(screen.getByText(/Real-Debrid Required/i)).toBeInTheDocument();
		expect(screen.getByText(/You must be logged in with Real-Debrid/i)).toBeInTheDocument();
		expect(screen.getByRole('link', { name: /Login with Real-Debrid/i })).toHaveAttribute(
			'href',
			'/realdebrid/login'
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

		expect(screen.getByText(/Warning: Never share this install URL/i)).toBeInTheDocument();
		expect(screen.getByText(/api\/stremio\/token123\/manifest\.json/i)).toBeInTheDocument();
	});
});
