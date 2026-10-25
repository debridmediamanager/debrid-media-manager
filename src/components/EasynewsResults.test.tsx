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
	it('points to Settings and searches nothing without a login', () => {
		const fetchMock = mockApi();
		render(<EasynewsResults title="Cocaine Bear" year="2023" />);
		expect(screen.getByRole('link', { name: 'Add it in Settings' })).toHaveAttribute(
			'href',
			'/settings'
		);
		expect(screen.queryByLabelText('Easynews password')).not.toBeInTheDocument();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('searches once with the saved login', async () => {
		localStorage.setItem('en:account', JSON.stringify(ACCOUNT));
		const fetchMock = mockApi();
		render(<EasynewsResults title="Cocaine Bear" year="2023" />);

		expect(await screen.findByText('Cocaine.Bear.2023.2160p')).toBeInTheDocument();
		expect(bodyOf(fetchMock.mock.calls[0])).toEqual({
			...ACCOUNT,
			title: 'Cocaine Bear',
			year: '2023',
		});
		// Easynews serves two searches at a time per account.
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('sends a refused login back to Settings', async () => {
		localStorage.setItem('en:account', JSON.stringify(ACCOUNT));
		mockApi(401);
		render(<EasynewsResults title="Cocaine Bear" year="2023" />);

		expect(
			await screen.findByText('Easynews rejected the username or password')
		).toBeInTheDocument();
		expect(screen.getByRole('link', { name: 'Easynews login' })).toHaveAttribute(
			'href',
			'/settings'
		);
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
});
