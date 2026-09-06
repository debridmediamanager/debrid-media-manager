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
	default: ({ href, children, ...rest }: any) => (
		<a href={typeof href === 'string' ? href : String(href)} {...rest}>
			{children}
		</a>
	),
}));

import TorznabSetupPage from '@/pages/torznab';

const asSponsor = () => sponsorMock.mockReturnValue({ isSponsor: true });
const asVisitor = () => sponsorMock.mockReturnValue({ isSponsor: false });

const field = (label: string) => screen.getByTestId(`field-${label}`);

const writeText = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
	sponsorMock.mockReset();
	writeText.mockClear();
	Object.defineProperty(navigator, 'clipboard', {
		value: { writeText },
		configurable: true,
		writable: true,
	});
});

describe('Torznab setup page, for a sponsor', () => {
	// The URL has to follow the instance the page is served from, or a
	// self-hosted DMM is handed the public host and every search leaves the box.
	it('names the endpoint on the origin it is served from', async () => {
		asSponsor();
		render(<TorznabSetupPage />);

		await waitFor(() =>
			expect(
				within(field('URL')).getByText(`${window.location.origin}/api/torznab`)
			).toBeTruthy()
		);
	});

	it('gives the API path *arr appends to that URL', () => {
		asSponsor();
		render(<TorznabSetupPage />);

		expect(within(field('API Path')).getByText('/api')).toBeTruthy();
	});

	it('never renders a key, and sends the sponsor to gatekeeper for it', () => {
		asSponsor();
		render(<TorznabSetupPage />);

		expect(within(field('API Key')).getByText('your DMM API key from gatekeeper')).toBeTruthy();
		expect(screen.queryByLabelText('Copy API Key')).toBeNull();
	});

	it('copies the URL on demand', async () => {
		asSponsor();
		render(<TorznabSetupPage />);

		await waitFor(() =>
			expect(
				within(field('URL')).getByText(`${window.location.origin}/api/torznab`)
			).toBeTruthy()
		);

		fireEvent.click(screen.getByLabelText('Copy URL'));
		await waitFor(() =>
			expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/api/torznab`)
		);
	});

	it('lists every search mode the endpoint answers', () => {
		asSponsor();
		render(<TorznabSetupPage />);

		expect(within(screen.getByTestId('mode-search')).getByText(/q=/)).toBeTruthy();
		expect(within(screen.getByTestId('mode-tvsearch')).getByText(/tvdbid=/)).toBeTruthy();
		expect(within(screen.getByTestId('mode-movie')).getByText(/imdbid=/)).toBeTruthy();
	});

	// The whole point of a debrid-backed indexer, and the one thing about this
	// feed that is not what a tracker would mean by it.
	it('explains what the seeder count actually reports', () => {
		asSponsor();
		render(<TorznabSetupPage />);

		expect(screen.getByText(/already\s+cached on a debrid service/)).toBeTruthy();
		expect(screen.getByTestId('feed-/cached')).toBeTruthy();
		expect(screen.getByTestId('feed-/rd/cached')).toBeTruthy();
	});

	it('advertises the movie and TV categories', () => {
		asSponsor();
		render(<TorznabSetupPage />);

		for (const id of ['2000', '2030', '2040', '2045', '5000', '5030', '5040', '5045']) {
			expect(screen.getByText(id)).toBeTruthy();
		}
	});

	it('states the per-key limit and says there is no grab budget', () => {
		asSponsor();
		render(<TorznabSetupPage />);

		expect(screen.getByText('30 searches')).toBeTruthy();
		expect(screen.getByText('No grab limit')).toBeTruthy();
		expect(screen.getByText(/Counted against your DMM API key, not your IP/)).toBeTruthy();
	});

	it('says the grab is a magnet DMM is not in the path of', () => {
		asSponsor();
		render(<TorznabSetupPage />);

		expect(screen.getByText(/Every result is a magnet link/)).toBeTruthy();
	});

	it('shows no sponsorship pitch to someone who already sponsors', () => {
		asSponsor();
		render(<TorznabSetupPage />);

		expect(screen.queryByRole('link', { name: 'Patreon' })).toBeNull();
		expect(screen.queryByText('Sponsors only')).toBeNull();
	});
});

describe('Torznab setup page, for everyone else', () => {
	it('withholds the endpoint details entirely', () => {
		asVisitor();
		render(<TorznabSetupPage />);

		expect(screen.queryByTestId('field-URL')).toBeNull();
		expect(screen.queryByText(`${window.location.origin}/api/torznab`)).toBeNull();
		expect(screen.queryByText('30 searches')).toBeNull();
	});

	it('makes the sponsorship pitch instead', () => {
		asVisitor();
		render(<TorznabSetupPage />);

		expect(screen.getByText('Sponsors only')).toBeTruthy();
		expect(screen.getByRole('link', { name: 'Github' }).getAttribute('href')).toContain(
			'github.com/sponsors'
		);
	});

	it('sends an existing sponsor to Settings to link their key', () => {
		asVisitor();
		render(<TorznabSetupPage />);

		expect(screen.getByRole('link', { name: 'Settings' }).getAttribute('href')).toBe(
			'/settings'
		);
		expect(screen.getByRole('link', { name: 'gatekeeper' }).getAttribute('href')).toBe(
			'https://gatekeeper.debridmediamanager.com'
		);
	});
});
