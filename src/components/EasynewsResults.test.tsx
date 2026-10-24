import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EasynewsResults from './EasynewsResults';

vi.mock('react-hot-toast', () => {
	const toastMock = { success: vi.fn(), error: vi.fn(), loading: vi.fn() };
	return { __esModule: true, default: toastMock, toast: toastMock };
});

const PATH = '682d74c4d3e935f0dee9a945a6e1a1d8010fde2f543e8.mkv/Cocaine.Bear.2023.mkv';
const RESULTS = [
	{ path: PATH, title: 'Cocaine.Bear.2023.2160p', size: 44 * 1024 ** 3 },
	{ path: `a${PATH}`, title: 'Cocaine.Bear.2023.720p', size: 2 * 1024 ** 3 },
];
const ACCOUNT = { username: 'user', password: 'pass' };

function mockApi(searchStatus = 200) {
	const fetchMock = vi.fn().mockImplementation((url: string) =>
		Promise.resolve(
			url.includes('/link')
				? {
						ok: true,
						json: async () => ({ url: 'https://ams-dl-01.easynews.com/dl/T/x.mkv' }),
					}
				: searchStatus === 200
					? { ok: true, json: async () => ({ results: RESULTS }) }
					: {
							ok: false,
							status: searchStatus,
							json: async () => ({
								error: 'Easynews rejected the username or password',
							}),
						}
		)
	);
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

const bodyOf = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string);

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('EasynewsResults', () => {
	it('asks for a login and searches nothing without one', () => {
		const fetchMock = mockApi();
		render(<EasynewsResults title="Cocaine Bear" year="2023" />);
		expect(screen.getByLabelText('Easynews username')).toBeInTheDocument();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('keeps a login only once Easynews accepts it', async () => {
		const fetchMock = mockApi();
		render(<EasynewsResults title="Cocaine Bear" year="2023" />);
		await userEvent.type(screen.getByLabelText('Easynews username'), 'user');
		await userEvent.type(screen.getByLabelText('Easynews password'), 'pass');
		await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

		expect(await screen.findByText('Cocaine.Bear.2023.2160p')).toBeInTheDocument();
		expect(bodyOf(fetchMock.mock.calls[0])).toEqual({
			...ACCOUNT,
			title: 'Cocaine Bear',
			year: '2023',
		});
		expect(JSON.parse(localStorage.getItem('en:account')!)).toEqual(ACCOUNT);
		// Saving the login must not search a second time: Easynews serves two
		// searches at a time per account (seen live on 2026-10-25, one sign-in, two calls).
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('does not save a login Easynews refuses', async () => {
		mockApi(401);
		render(<EasynewsResults title="Cocaine Bear" year="2023" />);
		await userEvent.type(screen.getByLabelText('Easynews username'), 'user');
		await userEvent.type(screen.getByLabelText('Easynews password'), 'wrong');
		await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

		expect(
			await screen.findByText('Easynews rejected the username or password')
		).toBeInTheDocument();
		expect(localStorage.getItem('en:account')).toBeNull();
	});

	it('searches a season with a saved login and applies the episode filter', async () => {
		localStorage.setItem('en:account', JSON.stringify(ACCOUNT));
		const fetchMock = mockApi();
		render(
			<EasynewsResults
				title="Severance"
				seasonNum={2}
				rowFilter={(title) => title.includes('720p')}
			/>
		);

		expect(await screen.findByText('Cocaine.Bear.2023.720p')).toBeInTheDocument();
		expect(screen.queryByText('Cocaine.Bear.2023.2160p')).not.toBeInTheDocument();
		expect(screen.getByText('(1 of 2)')).toBeInTheDocument();
		expect(bodyOf(fetchMock.mock.calls[0])).toMatchObject({ title: 'Severance', seasonNum: 2 });
	});

	it('waits for a real season number', () => {
		localStorage.setItem('en:account', JSON.stringify(ACCOUNT));
		const fetchMock = mockApi();
		render(<EasynewsResults title="Severance" seasonNum={NaN} />);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('copies a freshly signed link', async () => {
		localStorage.setItem('en:account', JSON.stringify(ACCOUNT));
		const fetchMock = mockApi();
		const user = userEvent.setup();
		const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
		render(<EasynewsResults title="Cocaine Bear" year="2023" />);

		await user.click(
			await screen.findByRole('button', {
				name: 'Copy Easynews link for Cocaine.Bear.2023.2160p',
			})
		);

		await waitFor(() =>
			expect(writeText).toHaveBeenCalledWith('https://ams-dl-01.easynews.com/dl/T/x.mkv')
		);
		const linkCall = fetchMock.mock.calls.find((c) =>
			String(c[0]).includes('/api/easynews/link')
		)!;
		expect(bodyOf(linkCall)).toEqual({ ...ACCOUNT, path: PATH });
	});

	it('forgets the login on sign out', async () => {
		localStorage.setItem('en:account', JSON.stringify(ACCOUNT));
		mockApi();
		render(<EasynewsResults title="Cocaine Bear" year="2023" />);
		await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
		expect(localStorage.getItem('en:account')).toBeNull();
		expect(screen.getByLabelText('Easynews username')).toBeInTheDocument();
	});
});
