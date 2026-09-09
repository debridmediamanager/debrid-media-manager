import { SPONSOR_API_KEY_KEY, SPONSOR_TOKEN_KEY } from '@/hooks/useSponsor';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const toastMock = vi.hoisted(() => {
	const fn = vi.fn() as ReturnType<typeof vi.fn> & { success: ReturnType<typeof vi.fn> };
	fn.success = vi.fn();
	return fn;
});

vi.mock('react-hot-toast', () => ({ default: toastMock }));

import { SponsorPanel } from './SponsorPanel';

const ACTIVE = {
	shortId: 'ZP1M',
	githubUsername: 'someone',
	sources: ['github', 'patreon'],
	keyVersion: 1,
	exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
};

function makeToken(claims: object) {
	return `${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;
}

function storeToken(claims: object) {
	window.localStorage.setItem(SPONSOR_TOKEN_KEY, JSON.stringify(makeToken(claims)));
}

const API_KEY = 'k'.repeat(64);

function storeApiKey(apiKey = API_KEY) {
	window.localStorage.setItem(SPONSOR_API_KEY_KEY, JSON.stringify(apiKey));
}

describe('SponsorPanel', () => {
	beforeEach(() => {
		window.localStorage.clear();
		toastMock.mockClear();
		toastMock.success.mockClear();
		vi.stubGlobal('fetch', vi.fn());
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('asks an unlinked visitor for their key and points them at gatekeeper', () => {
		render(<SponsorPanel />);
		expect(screen.getByPlaceholderText('64-character DMM API key')).toBeInTheDocument();
		expect(screen.getByRole('link', { name: 'gatekeeper' })).toHaveAttribute(
			'href',
			'https://gatekeeper.debridmediamanager.com'
		);
	});

	// The panel used to ask for money without saying what it buys, while the
	// features themselves were hidden from anyone who had not paid. Naming them
	// here, with links to the pages that now explain them, is the other half of
	// unhiding them.
	it('names what a sponsorship opens, and links the pages that explain it', () => {
		render(<SponsorPanel />);

		expect(screen.getByRole('link', { name: 'Usenet indexer' })).toHaveAttribute(
			'href',
			'/newznab'
		);
		expect(screen.getByRole('link', { name: 'Torrent indexer' })).toHaveAttribute(
			'href',
			'/torznab'
		);
		// Shipped after this list was written and left out of it, so it is asserted
		// by name rather than covered by "the panel lists some perks".
		expect(screen.getByRole('link', { name: 'Jellyfin plugins' })).toHaveAttribute(
			'href',
			'/jellyfin'
		);
		expect(screen.getByText('Ten other streams in Stremio Cast')).toBeInTheDocument();
		expect(screen.getByText('Skip the queue')).toBeInTheDocument();
	});

	it('drops the pitch once the sponsorship is linked', () => {
		storeToken(ACTIVE);
		storeApiKey();
		render(<SponsorPanel />);

		expect(screen.queryByRole('link', { name: 'Usenet indexer' })).toBeNull();
	});

	it('keeps submit disabled until a key is typed', async () => {
		render(<SponsorPanel />);
		const submit = screen.getByRole('button', { name: 'Verify sponsorship' });
		expect(submit).toBeDisabled();

		await userEvent.type(screen.getByPlaceholderText('64-character DMM API key'), 'k');
		expect(submit).toBeEnabled();
	});

	it('verifies a good key and switches to the badge', async () => {
		(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
			json: async () => ({ isSponsor: true, token: makeToken(ACTIVE), expiresIn: 604800 }),
		});
		render(<SponsorPanel />);

		await userEvent.type(
			screen.getByPlaceholderText('64-character DMM API key'),
			'a'.repeat(64)
		);
		await userEvent.click(screen.getByRole('button', { name: 'Verify sponsorship' }));

		expect(
			await screen.findByText('Verified via GitHub Sponsors · Patreon')
		).toBeInTheDocument();
		expect(toastMock.success).toHaveBeenCalled();
	});

	// The server distinguishes "no such key" from "sponsorship ended"; the panel
	// has to show that difference rather than a generic failure.
	it('shows the server error for a rejected key and keeps the form', async () => {
		(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
			json: async () => ({
				isSponsor: false,
				error: 'That key belongs to a sponsorship that is no longer active',
			}),
		});
		render(<SponsorPanel />);

		await userEvent.type(
			screen.getByPlaceholderText('64-character DMM API key'),
			'x'.repeat(64)
		);
		await userEvent.click(screen.getByRole('button', { name: 'Verify sponsorship' }));

		expect(
			await screen.findByText('That key belongs to a sponsorship that is no longer active')
		).toBeInTheDocument();
		expect(screen.getByPlaceholderText('64-character DMM API key')).toBeInTheDocument();
	});

	it('names every active sponsorship source', async () => {
		storeToken(ACTIVE);
		render(<SponsorPanel />);
		expect(
			await screen.findByText('Verified via GitHub Sponsors · Patreon')
		).toBeInTheDocument();
	});

	it('disconnecting clears the stored token and returns the form', async () => {
		storeToken(ACTIVE);
		render(<SponsorPanel />);

		await userEvent.click(await screen.findByRole('button', { name: /Disconnect/ }));

		await waitFor(() =>
			expect(screen.getByPlaceholderText('64-character DMM API key')).toBeInTheDocument()
		);
		expect(window.localStorage.getItem(SPONSOR_TOKEN_KEY)).toBeNull();
	});

	// A browser that linked before the key was worth keeping holds a token and
	// nothing else, and the indexer pages then have no key to fill in. Without
	// this, getting one back means disconnecting a working sponsorship first.
	it('asks a linked sponsor with no stored key for it again', async () => {
		storeToken(ACTIVE);
		render(<SponsorPanel />);

		expect(await screen.findByText(/have it filled in for you/)).toBeInTheDocument();
		expect(screen.getByPlaceholderText('64-character DMM API key')).toBeInTheDocument();
	});

	it('leaves a sponsor who already has a stored key alone', async () => {
		storeToken(ACTIVE);
		storeApiKey();
		render(<SponsorPanel />);

		await screen.findByRole('button', { name: /Disconnect/ });
		expect(screen.queryByPlaceholderText('64-character DMM API key')).toBeNull();
	});

	it('disconnecting drops the stored key too', async () => {
		storeToken(ACTIVE);
		storeApiKey();
		render(<SponsorPanel />);

		await userEvent.click(await screen.findByRole('button', { name: /Disconnect/ }));

		await waitFor(() => expect(window.localStorage.getItem(SPONSOR_API_KEY_KEY)).toBeNull());
	});
});
