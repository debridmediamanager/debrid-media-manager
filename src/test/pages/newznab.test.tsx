import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

import NewznabSetupPage from '@/pages/newznab';

const API_KEY = 'a1b2c3' + 'd'.repeat(54) + 'ef12';

const asSponsor = (apiKey: string | null = null) =>
	sponsorMock.mockReturnValue({ isSponsor: true, apiKey });
const asLinkedSponsor = () => asSponsor(API_KEY);
const asVisitor = () => sponsorMock.mockReturnValue({ isSponsor: false, apiKey: null });

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

afterEach(() => {
	vi.useRealTimers();
});

describe('Newznab setup page, for a sponsor', () => {
	// The URL has to follow the instance the page is served from, or a
	// self-hosted DMM is handed the public host and every search leaves the box.
	it('names the endpoint on the origin it is served from', async () => {
		asSponsor();
		render(<NewznabSetupPage />);

		await waitFor(() =>
			expect(
				within(field('URL')).getByText(`${window.location.origin}/api/newznab`)
			).toBeTruthy()
		);
	});

	it('gives the API path *arr appends to that URL', () => {
		asSponsor();
		render(<NewznabSetupPage />);

		expect(within(field('API Path')).getByText('/api')).toBeTruthy();
	});

	// A browser that never linked a key, or linked one before it was worth
	// keeping, has nothing to fill in — so the page has to say where to get one
	// rather than render an empty box.
	it('points at gatekeeper when this browser holds no key', () => {
		asSponsor(null);
		render(<NewznabSetupPage />);

		expect(within(field('API Key')).getByText('your DMM API key from gatekeeper')).toBeTruthy();
		expect(screen.queryByLabelText('Copy API Key')).toBeNull();
		expect(screen.queryByLabelText('Reveal API key')).toBeNull();
	});

	// Masked rather than printed: this page is what someone screen-shares while
	// wiring up their stack, and the copy button never needs it on screen.
	it('shows the linked key masked, and copies the whole thing', async () => {
		asLinkedSponsor();
		render(<NewznabSetupPage />);

		expect(within(field('API Key')).getByText('a1b2c3••••••••ef12')).toBeTruthy();
		expect(screen.queryByText(API_KEY)).toBeNull();

		fireEvent.click(screen.getByLabelText('Copy API Key'));
		await waitFor(() => expect(writeText).toHaveBeenCalledWith(API_KEY));
	});

	it('reveals the key on request, and hides it again', () => {
		asLinkedSponsor();
		render(<NewznabSetupPage />);

		fireEvent.click(screen.getByLabelText('Reveal API key'));
		expect(within(field('API Key')).getByText(API_KEY)).toBeTruthy();

		fireEvent.click(screen.getByLabelText('Hide API key'));
		expect(within(field('API Key')).getByText('a1b2c3••••••••ef12')).toBeTruthy();
	});

	it('offers a way back to the dashboard, as the other pages do', () => {
		asSponsor();
		render(<NewznabSetupPage />);

		expect(screen.getByRole('link', { name: 'Back to dashboard' }).getAttribute('href')).toBe(
			'/'
		);
	});

	it('sends the sponsor to gatekeeper for a key it does not have', () => {
		asSponsor(null);
		render(<NewznabSetupPage />);

		expect(screen.getByRole('link', { name: 'gatekeeper' })).toHaveAttribute(
			'href',
			'https://gatekeeper.debridmediamanager.com'
		);
	});

	it('copies the URL and the API path on demand', async () => {
		asSponsor();
		render(<NewznabSetupPage />);

		await waitFor(() =>
			expect(
				within(field('URL')).getByText(`${window.location.origin}/api/newznab`)
			).toBeTruthy()
		);

		fireEvent.click(screen.getByLabelText('Copy URL'));
		await waitFor(() =>
			expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/api/newznab`)
		);

		fireEvent.click(screen.getByLabelText('Copy API Path'));
		await waitFor(() => expect(writeText).toHaveBeenCalledWith('/api'));
	});

	it('lists every search mode the endpoint answers', () => {
		asSponsor();
		render(<NewznabSetupPage />);

		expect(within(screen.getByTestId('mode-search')).getByText(/q=/)).toBeTruthy();
		expect(within(screen.getByTestId('mode-tvsearch')).getByText(/tvdbid=/)).toBeTruthy();
		expect(within(screen.getByTestId('mode-tvsearch')).getByText(/season=/)).toBeTruthy();
		expect(within(screen.getByTestId('mode-movie')).getByText(/imdbid=/)).toBeTruthy();
	});

	it('advertises the movie and TV categories', () => {
		asSponsor();
		render(<NewznabSetupPage />);

		for (const id of ['2000', '2040', '2045', '5000', '5030', '5040', '5045', '5070']) {
			expect(screen.getByText(id)).toBeTruthy();
		}
	});

	// Stated up front so nobody discovers them by tripping them.
	it('states the per-key limits', () => {
		asSponsor();
		render(<NewznabSetupPage />);

		expect(screen.getByText('30 searches')).toBeTruthy();
		expect(screen.getByText('10 grabs')).toBeTruthy();
		expect(screen.getByText('150 grabs')).toBeTruthy();
		expect(screen.getAllByText('per minute')).toHaveLength(2);
		expect(screen.getByText('per day')).toBeTruthy();
		expect(screen.getByText(/counted against your DMM API key, not your IP/)).toBeTruthy();
	});

	it('says the NZBs are cleaned before they leave the server', () => {
		asSponsor();
		render(<NewznabSetupPage />);

		expect(screen.getByText(/cleaned server-side/)).toBeTruthy();
		expect(screen.getByText(/no per-download watermark reaches the client/)).toBeTruthy();
	});

	it('points at the SABnzbd side, which is what actually fetches a grab', () => {
		asSponsor();
		render(<NewznabSetupPage />);

		expect(
			screen.getByRole('link', { name: 'SABnzbd download client' }).getAttribute('href')
		).toBe('/sabnzbd');
	});

	it('shows no sponsorship pitch to someone who already sponsors', () => {
		asSponsor();
		render(<NewznabSetupPage />);

		expect(screen.queryByRole('link', { name: 'Patreon' })).toBeNull();
		expect(screen.queryByText('Sponsors only')).toBeNull();
	});
});

describe('Newznab setup page, for everyone else', () => {
	it('withholds the endpoint details entirely', () => {
		asVisitor();
		render(<NewznabSetupPage />);

		expect(screen.queryByTestId('field-URL')).toBeNull();
		expect(screen.queryByTestId('field-API Path')).toBeNull();
		expect(screen.queryByText(`${window.location.origin}/api/newznab`)).toBeNull();
		expect(screen.queryByText('/api')).toBeNull();
		expect(screen.queryByText('30 searches')).toBeNull();
	});

	it('makes the sponsorship pitch instead', () => {
		asVisitor();
		render(<NewznabSetupPage />);

		expect(screen.getByText('Sponsors only')).toBeTruthy();
		expect(screen.getByRole('link', { name: 'Github' }).getAttribute('href')).toContain(
			'github.com/sponsors'
		);
		expect(screen.getByRole('link', { name: 'Patreon' }).getAttribute('href')).toContain(
			'patreon.com'
		);
	});

	// A lapsed-looking visitor is often an existing sponsor on a fresh browser;
	// the fix is linking the key, not paying twice.
	it('sends an existing sponsor to Settings to link their key', () => {
		asVisitor();
		render(<NewznabSetupPage />);

		expect(screen.getByRole('link', { name: 'Settings' }).getAttribute('href')).toBe(
			'/settings'
		);
		expect(screen.getByRole('link', { name: 'gatekeeper' }).getAttribute('href')).toBe(
			'https://gatekeeper.debridmediamanager.com'
		);
	});
});
