import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EasynewsAccountPanel } from './EasynewsAccountPanel';

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

beforeEach(() => localStorage.clear());
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
});
