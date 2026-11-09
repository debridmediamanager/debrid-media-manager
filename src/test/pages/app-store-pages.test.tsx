import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

/**
 * App Store and Google Play link DMM Mobile to /privacy and /support, and their reviewers open
 * them signed out: behind withAuth they would land on /start instead.
 */

const authed = vi.fn();
vi.mock('@/utils/withAuth', () => ({ withAuth: (Component: any) => (authed(), Component) }));
vi.mock('next/head', () => ({
	__esModule: true,
	default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/Logo', () => ({ Logo: () => null }));

describe('the pages the app stores link to', () => {
	it('shows the privacy policy signed out, with a contact address', async () => {
		const { default: PrivacyPage } = await import('@/pages/privacy');
		render(<PrivacyPage />);

		expect(screen.getByRole('heading', { level: 1, name: 'Privacy policy' })).toBeTruthy();
		expect(
			screen
				.getAllByRole('link', { name: 'support@debridmediamanager.com' })[0]
				.getAttribute('href')
		).toBe('mailto:support@debridmediamanager.com');
		expect(authed).not.toHaveBeenCalled();
	});

	it('shows support signed out, with the demo key reviewers use', async () => {
		const { default: SupportPage } = await import('@/pages/support');
		render(<SupportPage />);

		expect(screen.getByRole('heading', { level: 1, name: 'Help and support' })).toBeTruthy();
		expect(screen.getByText('dmmdemo')).toBeTruthy();
		expect(authed).not.toHaveBeenCalled();
	});
});
