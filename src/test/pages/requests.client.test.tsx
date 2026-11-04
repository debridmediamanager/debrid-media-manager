import { useRealDebridAccessToken, useTorBoxAccessToken } from '@/hooks/auth';
import RequestsPage from '@/pages/requests';
import type { PublicRequest } from '@/utils/contentRequest';
import {
	fetchContentRequests,
	fetchFulfillerStats,
	fetchMyContentRequests,
	fileContentRequest,
	fulfillContentRequest,
	thankContentRequest,
} from '@/utils/contentRequestsApi';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/head', () => ({
	__esModule: true,
	default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@/hooks/auth', () => ({
	useRealDebridAccessToken: vi.fn(),
	useTorBoxAccessToken: vi.fn(),
}));
vi.mock('@/utils/contentRequestsApi', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/utils/contentRequestsApi')>()),
	fetchContentRequests: vi.fn(),
	fetchMyContentRequests: vi.fn(),
	fileContentRequest: vi.fn(),
	fulfillContentRequest: vi.fn(),
	cancelContentRequest: vi.fn(),
	thankContentRequest: vi.fn(),
	fetchFulfillerStats: vi.fn(() => new Promise(() => {})),
	fetchLeaderboard: vi.fn(() => new Promise(() => {})),
}));

// The asker's row as the board serves it to a stranger.
const ROW: PublicRequest = {
	id: 'c0592ec4-3833-418d-94c6-006299d00566',
	hash: 'e6c7bbf548fe9dd66c9b96dbef07b2427970aa29',
	imdbId: 'tt38263629',
	title: 'Mag Mag [2025 WEB-DLRip-AVC]',
	mediaType: 'movie',
	status: 'open',
	createdAt: '2026-09-06T06:21:32.396Z',
	mine: false,
	jobId: null,
	tbCached: true,
	error: null,
	wantedBy: 1,
	thanked: false,
	canThank: false,
	tries: 0,
	tbUnservable: false,
	sendingByMe: false,
};

beforeEach(() => {
	vi.clearAllMocks();
	globalThis.IntersectionObserver = class {
		observe() {}
		disconnect() {}
		unobserve() {}
	} as any;
	window.confirm = vi.fn(() => true);
	vi.mocked(fetchContentRequests).mockResolvedValue({
		requests: [ROW],
		authenticated: false,
		hasMore: false,
	});
	vi.mocked(fetchMyContentRequests).mockResolvedValue([]);
	vi.mocked(fulfillContentRequest).mockResolvedValue({ jobId: 'job-9', delivered: false });
});

// The fulfiller's Real-Debrid never takes part: the bytes come from their
// TorBox and land in the asker's Real-Debrid. The page used to hide Fulfil from
// anyone without both logins, turning away exactly the people with TorBox and no
// Real-Debrid that the board needs.
describe('RequestsPage for a fulfiller', () => {
	it('offers Fulfil with TorBox alone and sends no Real-Debrid key', async () => {
		vi.mocked(useRealDebridAccessToken).mockReturnValue([null, false, false] as any);
		vi.mocked(useTorBoxAccessToken).mockReturnValue('TB_KEY');
		render(<RequestsPage />);

		fireEvent.click(await screen.findByRole('button', { name: /Fulfil/ }));

		await waitFor(() =>
			expect(fulfillContentRequest).toHaveBeenCalledWith(null, ROW.id, { tbKey: 'TB_KEY' })
		);
		expect(screen.queryByText(/Sign in with Real-Debrid to fulfil/)).toBeNull();
	});

	it('still sends the Real-Debrid session when there is one', async () => {
		vi.mocked(useRealDebridAccessToken).mockReturnValue(['RD_TOKEN', false, false] as any);
		vi.mocked(useTorBoxAccessToken).mockReturnValue('TB_KEY');
		render(<RequestsPage />);

		fireEvent.click(await screen.findByRole('button', { name: /Fulfil/ }));

		await waitFor(() =>
			expect(fulfillContentRequest).toHaveBeenCalledWith('RD_TOKEN', ROW.id, {
				tbKey: 'TB_KEY',
			})
		);
	});

	it('offers no Fulfil without a TorBox key', async () => {
		vi.mocked(useRealDebridAccessToken).mockReturnValue(['RD_TOKEN', false, false] as any);
		vi.mocked(useTorBoxAccessToken).mockReturnValue(null as any);
		render(<RequestsPage />);

		await screen.findByText(ROW.title!);
		expect(screen.queryByRole('button', { name: /Fulfil/ })).toBeNull();
	});
});

describe('RequestsPage rewards', () => {
	it('shows how many people want a release', async () => {
		vi.mocked(useRealDebridAccessToken).mockReturnValue([null, false, false] as any);
		vi.mocked(useTorBoxAccessToken).mockReturnValue('TB_KEY');
		vi.mocked(fetchContentRequests).mockResolvedValue({
			requests: [{ ...ROW, wantedBy: 12 }],
			authenticated: false,
			hasMore: false,
		});
		render(<RequestsPage />);
		expect(await screen.findByText('Wanted by 12')).toBeTruthy();
	});

	it('lets the asker thank whoever sent their request', async () => {
		vi.mocked(useRealDebridAccessToken).mockReturnValue(['RD_TOKEN', false, false] as any);
		vi.mocked(useTorBoxAccessToken).mockReturnValue(null as any);
		vi.mocked(fetchMyContentRequests).mockResolvedValue([
			{ ...ROW, mine: true, status: 'fulfilled', canThank: true },
		]);
		vi.mocked(thankContentRequest).mockResolvedValue(undefined);
		render(<RequestsPage />);

		fireEvent.click(await screen.findByRole('button', { name: /Say thanks/ }));

		await waitFor(() => expect(thankContentRequest).toHaveBeenCalledWith('RD_TOKEN', ROW.id));
		expect(await screen.findByText('Thanked')).toBeTruthy();
	});

	it('shows a fulfiller their progress toward sponsor time', async () => {
		vi.mocked(useRealDebridAccessToken).mockReturnValue([null, false, false] as any);
		vi.mocked(useTorBoxAccessToken).mockReturnValue('TB_KEY');
		vi.mocked(fetchFulfillerStats).mockResolvedValue({
			sends: 13,
			thanked: 4,
			credited: 13,
			sendsPerBlock: 10,
			daysPerBlock: 7,
			linked: false,
			showName: false,
			earnedUntil: null,
			sending: 0,
			recent: [],
		});
		render(<RequestsPage />);
		const bar = await screen.findByRole('progressbar');
		expect(bar.getAttribute('aria-valuenow')).toBe('3');
		// Unlinked, the key form waits behind one button.
		expect(screen.queryByLabelText('Show my GitHub name on the leaderboard')).toBeNull();
		fireEvent.click(screen.getByRole('button', { name: 'Link your DMM API key to collect' }));
		// Earned time opens DMM's perks only, never zurg or rex access.
		expect(screen.getByText(/does not include zurg or rex access/)).toBeTruthy();
		expect(screen.getByLabelText('Show my GitHub name on the leaderboard')).toBeTruthy();
	});

	it('folds an uncached miss into the chip and shortens noisy reasons', async () => {
		vi.mocked(useRealDebridAccessToken).mockReturnValue([null, false, false] as any);
		vi.mocked(useTorBoxAccessToken).mockReturnValue(null as any);
		const tb404 = 'TorBox reports the release cached but serves 404';
		vi.mocked(fetchContentRequests).mockResolvedValue({
			requests: [
				{ ...ROW, id: 'a', status: 'failed', error: 'uncached' },
				{ ...ROW, id: 'b', status: 'failed', error: `${tb404} for Some.Release/file.mkv` },
			],
			authenticated: false,
			hasMore: false,
		});
		render(<RequestsPage />);
		expect(await screen.findByText('Open — last try: not cached')).toBeTruthy();
		expect(screen.queryByText('uncached')).toBeNull();
		const line = screen.getByText(tb404);
		expect(line.getAttribute('title')).toBe(`${tb404} for Some.Release/file.mkv`);
		// The title is the link to the film; the bare IMDb id is gone.
		expect(screen.getAllByRole('link', { name: ROW.title! })[0].getAttribute('href')).toBe(
			`/movie/${ROW.imdbId}`
		);
		expect(screen.queryByText(ROW.imdbId)).toBeNull();
	});
});

// Lew, 2026-11-03: "I have just sent one ... it has added to my torbox but
// shows I haven't sent it". The send was running, then failed, and nothing on
// the page ever said so.
describe('RequestsPage tells a fulfiller what became of their sends', () => {
	const stats = {
		sends: 3,
		thanked: 0,
		credited: 3,
		sendsPerBlock: 10,
		daysPerBlock: 7,
		linked: false,
		showName: false,
		earnedUntil: null,
		sending: 1,
		recent: [
			{
				title: 'Coyote Vs Acme (2026) 2160p WEBRip',
				hash: '8'.repeat(40),
				status: 'sending' as const,
				reason: null,
				startedAt: new Date(Date.now() - 12 * 60_000).toISOString(),
				endedAt: null,
			},
			{
				title: "Earth's Greatest Enemy (2025)",
				hash: '5'.repeat(40),
				status: 'failed' as const,
				reason: 'Real-Debrid stopped pulling it. Not your fault, not counted.',
				startedAt: new Date(Date.now() - 40 * 60_000).toISOString(),
				endedAt: new Date(Date.now() - 30 * 60_000).toISOString(),
			},
		],
	};

	beforeEach(() => {
		vi.mocked(useRealDebridAccessToken).mockReturnValue([null, false, false] as any);
		vi.mocked(useTorBoxAccessToken).mockReturnValue('TB_KEY');
	});

	it('marks the row they are sending and lists how each send went', async () => {
		vi.mocked(fetchFulfillerStats).mockResolvedValue(stats);
		vi.mocked(fetchContentRequests).mockResolvedValue({
			requests: [{ ...ROW, status: 'claimed', jobId: 'job-1', sendingByMe: true }],
			authenticated: false,
			hasMore: false,
		});
		render(<RequestsPage />);
		expect(await screen.findByText('Sending — you')).toBeTruthy();
		expect(await screen.findByText("Didn't make it")).toBeTruthy();
		expect(screen.getAllByText('Sending').length).toBeGreaterThan(0);
		expect(
			screen.getByText('Real-Debrid stopped pulling it. Not your fault, not counted.')
		).toBeTruthy();
		expect(screen.getByText('Coyote Vs Acme (2026) 2160p WEBRip')).toBeTruthy();
	});

	it('says what a send involves before it starts', async () => {
		render(<RequestsPage />);
		fireEvent.click(await screen.findByRole('button', { name: /Fulfil/ }));
		const message = vi.mocked(window.confirm).mock.calls[0][0] as string;
		expect(message).toMatch(/about half an hour/);
		expect(message).toMatch(/shows up in your TorBox/);
		expect(message).toMatch(/counts as a send once it lands/);
		expect(screen.getByText('Only releases TorBox has cached')).toBeTruthy();
	});

	// "Alpha (2026) Hindi": 94 tries by 59 people, every one a 404, and the row
	// still said "TB cached" with a Fulfil button next to it.
	it('offers no Fulfil for a release TorBox could not serve, and says why', async () => {
		vi.mocked(fetchContentRequests).mockResolvedValue({
			requests: [{ ...ROW, tbUnservable: true, tries: 94 }],
			authenticated: false,
			hasMore: false,
		});
		render(<RequestsPage />);
		expect(await screen.findByText("TorBox can't serve it yet")).toBeTruthy();
		expect(screen.getByText('tried 94×')).toBeTruthy();
		expect(screen.queryByRole('button', { name: /Fulfil/ })).toBeNull();
	});
});

describe('RequestsPage for an asker whose request expired', () => {
	it('puts it back on the board with one click', async () => {
		vi.mocked(useRealDebridAccessToken).mockReturnValue(['RD_KEY', false, false] as any);
		vi.mocked(useTorBoxAccessToken).mockReturnValue(null as any);
		vi.mocked(fetchContentRequests).mockResolvedValue({
			requests: [],
			authenticated: true,
			hasMore: false,
		});
		vi.mocked(fetchMyContentRequests).mockResolvedValue([
			{ ...ROW, status: 'expired', mine: true },
		]);
		vi.mocked(fileContentRequest).mockResolvedValue({
			delivered: false,
			request: { ...ROW, status: 'open', mine: true },
		});
		render(<RequestsPage />);
		expect(await screen.findByText('Expired. Nobody sent it in 60 days')).toBeTruthy();
		fireEvent.click(screen.getByRole('button', { name: /Ask again/ }));
		await waitFor(() => expect(fileContentRequest).toHaveBeenCalled());
		expect(vi.mocked(fileContentRequest).mock.calls[0]).toEqual([
			'RD_KEY',
			{ hash: ROW.hash, imdbId: ROW.imdbId, title: ROW.title, mediaType: 'movie' },
		]);
		expect(await screen.findByText('Waiting for someone to send it')).toBeTruthy();
	});
});
