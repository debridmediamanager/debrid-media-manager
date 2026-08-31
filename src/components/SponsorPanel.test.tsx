import { SPONSOR_TOKEN_KEY } from '@/hooks/useSponsor';
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
});
