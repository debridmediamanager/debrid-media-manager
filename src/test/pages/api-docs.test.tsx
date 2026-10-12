import { render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/Logo', () => ({
	__esModule: true,
	Logo: () => <div data-testid="logo" />,
}));

vi.mock('next/head', () => ({
	__esModule: true,
	default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('next/link', () => ({
	__esModule: true,
	default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
		<a href={href} {...rest}>
			{children}
		</a>
	),
}));

import ApiDocsPage from '@/pages/api-docs';
import { GATEKEEPER_URL } from '@/utils/gatekeeper';

const SPONSOR_ONLY = [
	'/api/torznab/api',
	'/api/newznab/api',
	'/api/plugins/manifest.json',
	'/api/emby-plugins/',
	'/api/sponsor/identify',
	'/api/sponsor/availability',
	'/api/torrents/identify',
	'/api/zurg/search-torrents',
	'/api/zurg/show-info',
	'/api/zurg/resolve-tmdb',
];
const OPEN = [
	'/api/stremio/<your id>/manifest.json',
	'/api/sabnzbd/<mount root>/api',
	'/api/takedown',
];

describe('/api-docs', () => {
	it.each(SPONSOR_ONLY)('marks %s sponsors only, linked to gatekeeper', (path) => {
		render(<ApiDocsPage />);

		const badge = within(screen.getByTestId(`endpoint-${path}`)).getByRole('link', {
			name: 'Sponsors only',
		});
		expect(badge).toHaveAttribute('href', GATEKEEPER_URL);
	});

	it.each(OPEN)('leaves %s open', (path) => {
		render(<ApiDocsPage />);

		expect(
			within(screen.getByTestId(`endpoint-${path}`)).queryByText('Sponsors only')
		).not.toBeInTheDocument();
	});

	it('tells SABnzbd users the allowance and where a sponsor key goes', () => {
		render(<ApiDocsPage />);

		const row = within(screen.getByTestId('endpoint-/api/sabnzbd/<mount root>/api'));
		expect(row.getByText(/300 GB of Usenet per account, 2 TB/)).toBeInTheDocument();
		expect(row.getByText(/Sponsors add their DMM API key as the Password/)).toBeInTheDocument();
	});

	it('states the limits the routes enforce', () => {
		render(<ApiDocsPage />);

		expect(
			within(screen.getByTestId('endpoint-/api/sponsor/identify')).getByText(
				/5 calls per minute/
			)
		).toBeInTheDocument();
		expect(
			within(screen.getByTestId('endpoint-/api/sponsor/availability')).getByText(
				/25 calls per minute/
			)
		).toBeInTheDocument();
	});
});
