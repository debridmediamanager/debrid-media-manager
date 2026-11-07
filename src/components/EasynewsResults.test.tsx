import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EasynewsResults from './EasynewsResults';

const sponsorMock = vi.hoisted(() => vi.fn(() => ({ isSponsor: false })));
vi.mock('@/hooks/useSponsor', () => ({
	useSponsor: () => sponsorMock(),
	sponsorHeaders: () => ({ 'x-dmm-sponsor': 'token' }),
}));

vi.mock('react-hot-toast', () => {
	const toastMock = { success: vi.fn(), error: vi.fn(), loading: vi.fn() };
	return { __esModule: true, default: toastMock, toast: toastMock };
});

const PATH = '682d74c4d3e935f0dee9a945a6e1a1d8010fde2f543e8.mkv/Cocaine.Bear.2023.mkv';
const HASH = '682d74c4d3e935f0dee9a945a6e1a1d8010fde2f543e8';
const RESULTS = [
	{ path: PATH, title: 'Cocaine.Bear.2023.2160p', size: 44 * 1024 ** 3, sig: 'S'.repeat(143) },
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

beforeEach(() => {
	localStorage.clear();
	sponsorMock.mockReturnValue({ isSponsor: false });
});
afterEach(() => vi.unstubAllGlobals());

describe('EasynewsResults', () => {
	it('points to Settings and searches nothing without a login', () => {
		const fetchMock = mockApi();
		render(
			<EasynewsResults title="Cocaine Bear" imdbId="tt14209916" kind="movie" year="2023" />
		);
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
		render(
			<EasynewsResults title="Cocaine Bear" imdbId="tt14209916" kind="movie" year="2023" />
		);

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
		render(
			<EasynewsResults title="Cocaine Bear" imdbId="tt14209916" kind="movie" year="2023" />
		);

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
				imdbId="tt11280740"
				kind="show"
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
		render(
			<EasynewsResults title="Severance" imdbId="tt11280740" kind="show" seasonNum={NaN} />
		);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('copies a freshly signed link', async () => {
		localStorage.setItem('en:account', JSON.stringify(ACCOUNT));
		const fetchMock = mockApi();
		const user = userEvent.setup();
		const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
		render(
			<EasynewsResults title="Cocaine Bear" imdbId="tt14209916" kind="movie" year="2023" />
		);

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

	it('sends a row to zurg for a non-sponsor via the wanted page', async () => {
		localStorage.setItem('en:account', JSON.stringify(ACCOUNT));
		mockApi();
		render(
			<EasynewsResults title="Cocaine Bear" imdbId="tt14209916" kind="movie" year="2023" />
		);
		await screen.findByText('Cocaine.Bear.2023.2160p');
		const links = screen.getAllByRole('link', { name: 'Send to zurg' });
		expect(links[0]).toHaveAttribute('href', '/wanted');
		expect(links[0]).toHaveAttribute(
			'title',
			"Sponsors' zurg fetches titles from their wanted list"
		);
		expect(
			screen.getByRole('button', { name: 'Download Cocaine.Bear.2023.2160p from Easynews' })
		).toBeInTheDocument();
	});

	describe('for a sponsor', () => {
		const wantedRow = (over: Record<string, unknown> = {}) => ({
			id: 'w',
			imdbId: 'tt14209916',
			kind: 'movie',
			title: 'Cocaine Bear',
			seasons: null,
			createdAt: '2026-11-07T10:00:00.000Z',
			fulfilledAt: null,
			fulfilled: null,
			lastPolledAt: null,
			...over,
		});
		const pinned = { id: HASH, release: 'Cocaine.Bear.2023.mkv', size: 1, at: 'x' };

		function mockSponsorApi(listed: unknown[]) {
			const fetchMock = mockApi();
			const search = fetchMock.getMockImplementation()!;
			fetchMock.mockImplementation((url: string, init?: RequestInit) => {
				if (url === '/api/wanted')
					return Promise.resolve({ ok: true, json: async () => ({ items: listed }) });
				if (url === '/api/easynews/send')
					return Promise.resolve({
						ok: true,
						json: async () => ({ item: wantedRow({ pins: [pinned] }) }),
					});
				return search(url, init);
			});
			return fetchMock;
		}

		beforeEach(() => {
			sponsorMock.mockReturnValue({ isSponsor: true });
			localStorage.setItem('en:account', JSON.stringify(ACCOUNT));
		});

		it('sends the row with its sig and shows it sent', async () => {
			const fetchMock = mockSponsorApi([]);
			const user = userEvent.setup();
			render(
				<EasynewsResults
					title="Cocaine Bear"
					imdbId="tt14209916"
					kind="movie"
					year="2023"
				/>
			);
			await screen.findByText('Cocaine.Bear.2023.2160p');
			await user.click(screen.getAllByRole('button', { name: 'Send to zurg' })[0]);

			expect(await screen.findByRole('button', { name: 'Sent to zurg' })).toBeEnabled();
			const call = fetchMock.mock.calls.find((c) => c[0] === '/api/easynews/send')!;
			expect(bodyOf(call)).toEqual({
				...ACCOUNT,
				path: PATH,
				sig: 'S'.repeat(143),
				size: 44 * 1024 ** 3,
				imdbId: 'tt14209916',
				kind: 'movie',
				title: 'Cocaine Bear',
			});
			expect((call[1] as RequestInit).headers).toMatchObject({ 'x-dmm-sponsor': 'token' });
			// One wanted-list read for the whole section.
			expect(fetchMock.mock.calls.filter((c) => c[0] === '/api/wanted')).toHaveLength(1);
		});

		it('says zurg took a pinned film once it is acknowledged', async () => {
			mockSponsorApi([
				wantedRow({ pins: [pinned], fulfilledAt: '2026-11-07T11:00:00.000Z' }),
			]);
			render(
				<EasynewsResults
					title="Cocaine Bear"
					imdbId="tt14209916"
					kind="movie"
					year="2023"
				/>
			);
			expect(await screen.findByRole('button', { name: 'zurg took it' })).toBeDisabled();
			expect(screen.getByRole('button', { name: 'Send to zurg' })).toBeEnabled();
		});

		it('puts Download back as the main button when Send to zurg is switched off', async () => {
			localStorage.setItem('en:sendToZurg', 'false');
			mockSponsorApi([]);
			render(
				<EasynewsResults
					title="Cocaine Bear"
					imdbId="tt14209916"
					kind="movie"
					year="2023"
				/>
			);
			await screen.findByText('Cocaine.Bear.2023.2160p');
			expect(screen.queryByRole('button', { name: 'Send to zurg' })).toBeNull();
			expect(
				screen.getAllByRole('button', { name: /^Download .* from Easynews$/ })[0]
			).toHaveTextContent('Download');
		});
	});
});
