import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sponsorMock = vi.fn();

vi.mock('@/hooks/useSponsor', () => ({
	__esModule: true,
	useSponsor: () => sponsorMock(),
}));

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

import JellyfinSetupPage from '@/pages/jellyfin';

const API_KEY = 'a1b2c3' + 'd'.repeat(54) + 'ef12';
const MASKED = 'a1b2c3' + '•'.repeat(8) + 'ef12';

const asSponsor = (apiKey: string | null = null) =>
	sponsorMock.mockReturnValue({ isSponsor: true, apiKey });
const asVisitor = () => sponsorMock.mockReturnValue({ isSponsor: false, apiKey: null });

const field = (label: string) => screen.getByTestId(`field-${label}`);
const writeText = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
	sponsorMock.mockReset();
	writeText.mockClear();
	Object.assign(navigator, { clipboard: { writeText } });
});

describe('the repository URL', () => {
	it('does not put the key on screen until it is asked for', async () => {
		asSponsor(API_KEY);
		render(<JellyfinSetupPage />);

		const row = field('Repository URL');
		expect(within(row).getByText(new RegExp(MASKED.replace(/•/g, '.')))).toBeTruthy();
		// The whole point: a screenshot of this page must not carry the key.
		expect(row.textContent).not.toContain(API_KEY);
	});

	it('copies the real URL even while it is masked', async () => {
		asSponsor(API_KEY);
		render(<JellyfinSetupPage />);

		fireEvent.click(within(field('Repository URL')).getByLabelText('Copy Repository URL'));

		await waitFor(() =>
			expect(writeText).toHaveBeenCalledWith(
				`http://localhost:3000/api/plugins/manifest.json?apikey=${API_KEY}`
			)
		);
	});

	it('reveals the key only on request', async () => {
		asSponsor(API_KEY);
		render(<JellyfinSetupPage />);

		fireEvent.click(screen.getByLabelText('Reveal repository URL'));

		expect(field('Repository URL').textContent).toContain(API_KEY);
	});

	it('tells an unlinked browser where a key comes from', () => {
		asSponsor(null);
		render(<JellyfinSetupPage />);

		const row = field('Repository URL');
		expect(row.textContent).toContain('your DMM API key');
		expect(within(row).queryByLabelText('Copy Repository URL')).toBeNull();
	});
});

describe('the page', () => {
	it('names every plugin the catalog offers', () => {
		asSponsor(API_KEY);
		render(<JellyfinSetupPage />);

		// The catalog has served PM, OC and DL zurg since 2026-09-13 while this page still
		// listed only the first four, so a sponsor could not tell they existed.
		for (const name of [
			'RD zurg',
			'AD zurg',
			'TB zurg',
			'PM zurg',
			'OC zurg',
			'DL zurg',
			'NZB zurg',
		]) {
			expect(screen.getByTestId(`plugin-${name}`)).toBeTruthy();
		}
	});

	it('names every account a plugin serves in the introduction', () => {
		asVisitor();
		render(<JellyfinSetupPage />);

		const intro = screen.getByText(/plugins that add your/).textContent ?? '';
		for (const account of [
			'Real-Debrid',
			'AllDebrid',
			'TorBox',
			'Premiumize',
			'Offcloud',
			'Debrid-Link',
			'Usenet',
		]) {
			expect(intro).toContain(account);
		}
	});

	it('pitches a sponsorship to a visitor, and not to a sponsor', () => {
		asVisitor();
		const { unmount } = render(<JellyfinSetupPage />);
		expect(screen.getByText('A sponsor feature')).toBeTruthy();
		unmount();

		asSponsor(API_KEY);
		render(<JellyfinSetupPage />);
		expect(screen.queryByText('A sponsor feature')).toBeNull();
	});

	it('keeps the setup visible to a visitor, since the endpoint is the real gate', () => {
		asVisitor();
		render(<JellyfinSetupPage />);
		expect(screen.getByText('1. Add the repository to Jellyfin')).toBeTruthy();
	});
});
