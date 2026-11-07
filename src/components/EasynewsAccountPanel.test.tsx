import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EasynewsAccountPanel } from './EasynewsAccountPanel';

const pushMock = vi.hoisted(() => vi.fn());
vi.mock('next/router', () => ({ __esModule: true, default: { push: pushMock } }));

const ACCOUNT = { username: 'user', password: 'pass' };

function mockAccountCheck(status = 200) {
	const fetchMock = vi.fn().mockResolvedValue(
		status === 200
			? { ok: true, json: async () => ({ ok: true }) }
			: {
					ok: false,
					status,
					json: async () => ({ error: 'Easynews rejected the username or password' }),
				}
	);
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

async function signIn(password: string) {
	await userEvent.type(screen.getByLabelText('Easynews username'), 'user');
	await userEvent.type(screen.getByLabelText('Easynews password'), password);
	await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

beforeEach(() => {
	localStorage.clear();
	pushMock.mockReset();
	window.history.replaceState({}, '', '/settings');
});
afterEach(() => vi.unstubAllGlobals());

describe('EasynewsAccountPanel', () => {
	it('keeps a login only once Easynews accepts it', async () => {
		const fetchMock = mockAccountCheck();
		render(<EasynewsAccountPanel />);
		await signIn('pass');

		expect(await screen.findByText('user')).toBeInTheDocument();
		expect(fetchMock.mock.calls[0][0]).toBe('/api/easynews/account');
		expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual(
			ACCOUNT
		);
		expect(JSON.parse(localStorage.getItem('en:account')!)).toEqual(ACCOUNT);
	});

	// DMM Cast for Easynews and Kodi pairing send a visitor here to sign in.
	it('returns to the page that asked, after a sign-in Easynews accepts', async () => {
		mockAccountCheck();
		window.history.replaceState({}, '', '/settings?redirect=%2Fkodi%3Fcode%3DAB12');
		render(<EasynewsAccountPanel />);
		await signIn('pass');
		await screen.findByText('user');
		expect(pushMock).toHaveBeenCalledWith('/kodi?code=AB12');
	});

	it('never redirects off DMM, and stays without a redirect', async () => {
		mockAccountCheck();
		window.history.replaceState({}, '', '/settings?redirect=https%3A%2F%2Fevil.example');
		const { unmount } = render(<EasynewsAccountPanel />);
		await signIn('pass');
		await screen.findByText('user');
		expect(pushMock).toHaveBeenCalledWith('/settings');
		unmount();
		localStorage.clear();
		pushMock.mockReset();

		window.history.replaceState({}, '', '/settings');
		render(<EasynewsAccountPanel />);
		await signIn('pass');
		await screen.findByText('user');
		expect(pushMock).not.toHaveBeenCalled();
		expect(screen.getByRole('link', { name: /DMM Cast for Easynews/ })).toHaveAttribute(
			'href',
			'/stremio-easynews'
		);
	});

	// Easynews is no debrid account: a browser with only it is a guest that can cast.
	it('enters guest mode on a sign-in with no debrid account, and not with one', async () => {
		mockAccountCheck();
		const { unmount } = render(<EasynewsAccountPanel />);
		await signIn('pass');
		await screen.findByText('user');
		expect(localStorage.getItem('dmm:guest')).toBe('true');
		unmount();

		localStorage.clear();
		localStorage.setItem('tb:apiKey', 'tb-key');
		render(<EasynewsAccountPanel />);
		await signIn('pass');
		await screen.findByText('user');
		expect(localStorage.getItem('dmm:guest')).toBeNull();
	});

	it('does not save a login Easynews refuses', async () => {
		mockAccountCheck(401);
		render(<EasynewsAccountPanel />);
		await signIn('wrong');

		expect(
			await screen.findByText('Easynews rejected the username or password')
		).toBeInTheDocument();
		expect(localStorage.getItem('en:account')).toBeNull();
	});

	it('forgets the login on sign out', async () => {
		localStorage.setItem('en:account', JSON.stringify(ACCOUNT));
		render(<EasynewsAccountPanel />);
		await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));

		expect(localStorage.getItem('en:account')).toBeNull();
		expect(screen.getByLabelText('Easynews username')).toBeInTheDocument();
	});

	it('shows Send to zurg unless it is switched off under the login', async () => {
		localStorage.setItem('en:account', JSON.stringify(ACCOUNT));
		render(<EasynewsAccountPanel />);
		const box = screen.getByRole('checkbox', { name: 'Show Send to zurg on Easynews results' });
		expect(box).toBeChecked();
		await userEvent.click(box);
		expect(localStorage.getItem('en:sendToZurg')).toBe('false');
		expect(box).not.toBeChecked();
	});
});
