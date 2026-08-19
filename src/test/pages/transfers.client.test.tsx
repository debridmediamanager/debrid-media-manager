import { render, screen, waitFor } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRouter = {
	pathname: '/transfers',
	asPath: '/transfers',
	query: {} as Record<string, string | string[]>,
	push: vi.fn(),
	replace: vi.fn().mockResolvedValue(true),
	events: { on: vi.fn(), off: vi.fn() },
};

vi.mock('next/router', () => ({
	__esModule: true,
	useRouter: () => mockRouter,
}));

// Mutable so one test can render the page the way the *server* sees it — with no
// key, because localStorage does not exist there.
let currentRdKey: string | null = 'test-rd-key';
vi.mock('@/hooks/auth', () => ({
	__esModule: true,
	useRealDebridAccessToken: () => [currentRdKey, false, false],
}));

const mockAddHashAsMagnet = vi.fn().mockResolvedValue('rd-torrent-id');
const mockSelectFiles = vi.fn().mockResolvedValue(undefined);
vi.mock('@/services/realDebrid', () => ({
	__esModule: true,
	addHashAsMagnet: (...args: any[]) => mockAddHashAsMagnet(...args),
	selectFiles: (...args: any[]) => mockSelectFiles(...args),
}));

import TransfersPage from '@/pages/transfers';
import { getTrackedDebridUploaderJobs, trackDebridUploaderJob } from '@/utils/debridUploader';

const HASH = 'a'.repeat(40);
const REWRITTEN = 'b'.repeat(40);

const row = (over: Record<string, unknown> = {}) => ({
	source: 'debrid',
	id: 'job-1',
	status: 'completed',
	createdAt: 1700000000000,
	info_hash: REWRITTEN,
	name: 'Tracked Movie',
	...over,
});

const listResponse = (transfers: unknown[], degraded: string[] = []) => ({
	ok: true,
	status: 200,
	json: async () => ({ transfers, degraded }),
});

beforeEach(() => {
	localStorage.clear();
	vi.clearAllMocks();
	currentRdKey = 'test-rd-key';
	vi.stubGlobal('fetch', vi.fn().mockResolvedValue(listResponse([row()])));
});

describe('Transfers page hydration', () => {
	it('renders identical markup with and without a key, before anything loads', () => {
		// The server cannot read localStorage, so it always renders with rdKey
		// null, while the client's `useLocalStorage` reads it synchronously and
		// has one on its very first paint. If the page branches on `rdKey` before
		// it has loaded, those two markups differ and React fails hydration —
		// which is exactly what happened: the signed-out prompt on one side, the
		// spinner on the other, and a different `disabled` on the refresh button.
		currentRdKey = null;
		const asServer = renderToString(<TransfersPage />);
		currentRdKey = 'test-rd-key';
		const asClient = renderToString(<TransfersPage />);

		expect(asClient).toEqual(asServer);
		expect(asServer).toContain('Loading your transfers');
	});

	it('stops loading for a signed-out visitor instead of spinning forever', () => {
		// `loaded` gates every branch now, and only `refresh` sets it — which
		// returns early with no key. Without the explicit set, a signed-out
		// visitor never leaves the spinner.
		currentRdKey = null;
		render(<TransfersPage />);

		expect(screen.getByText(/Sign in with Real-Debrid/i)).toBeInTheDocument();
	});
});

// The whole point of the change: the list is the account's, fetched in one
// request, rather than a per-browser list polled one job at a time.
describe('Transfers page listing', () => {
	it('renders from one /api/transfers call, with the key as a header', async () => {
		render(<TransfersPage />);

		await waitFor(() => expect(screen.getByText('Tracked Movie')).toBeInTheDocument());
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(fetch).toHaveBeenCalledWith('/api/transfers', {
			headers: { 'x-rd-api-key': 'test-rd-key' },
		});
		// Never the query string: nginx logs the request line, and this is polled
		// every five seconds per open tab.
		expect((fetch as any).mock.calls[0][0]).not.toContain('test-rd-key');
	});

	it('shows a transfer this browser never started', async () => {
		// An *arr job pushed into nzb2rd, or one started on another device. There
		// is no localStorage entry for it, and it still belongs on the page.
		vi.mocked(fetch as any).mockResolvedValue(
			listResponse([row({ source: 'nzb2rd', id: 'job-arr', name: 'Someone Elses Release' })])
		);

		render(<TransfersPage />);

		await waitFor(() => expect(screen.getByText('Someone Elses Release')).toBeInTheDocument());
	});

	it('prefers the stored DMM title over the raw release name', async () => {
		vi.mocked(fetch as any).mockResolvedValue(
			listResponse([row({ title: 'The Nice Title', name: 'raw.release.2160p.x265' })])
		);

		render(<TransfersPage />);

		await waitFor(() => expect(screen.getByText('The Nice Title')).toBeInTheDocument());
	});

	it('warns when a service is unreachable rather than just showing a shorter list', async () => {
		// Silently dropping those rows reads as "that transfer is gone", which is
		// the most alarming thing this page can say by accident.
		vi.mocked(fetch as any).mockResolvedValue(listResponse([], ['nzb2rd']));

		render(<TransfersPage />);

		await waitFor(() => expect(screen.getByText(/may be incomplete/i)).toBeInTheDocument());
	});

	it('reports a failed listing instead of rendering an empty page', async () => {
		vi.mocked(fetch as any).mockResolvedValue({
			ok: false,
			status: 502,
			json: async () => ({ error: 'Could not reach the transfer services' }),
		});

		render(<TransfersPage />);

		await waitFor(() =>
			expect(screen.getByText(/Could not load your transfers/i)).toBeInTheDocument()
		);
	});
});

// A transfer started by somebody else finishes in *their* RD account. The send
// flow adds it to this user's RD when the page that joined it is still open —
// the Transfers page is what closes the gap for everyone who navigated away.
describe('Transfers page RD handoff', () => {
	it('adds a joined transfer to RD once it has completed', async () => {
		trackDebridUploaderJob({
			id: 'job-1',
			hash: HASH,
			imdbId: 'tt1234567',
			title: 'Tracked Movie',
			createdAt: 1700000000000,
			adopted: true,
		});

		render(<TransfersPage />);

		await waitFor(() =>
			expect(mockAddHashAsMagnet).toHaveBeenCalledWith('test-rd-key', REWRITTEN, true)
		);
		expect(mockSelectFiles).toHaveBeenCalledWith('test-rd-key', 'rd-torrent-id', ['all'], true);
		await waitFor(() => expect(getTrackedDebridUploaderJobs()[0].rdAdded).toBe(true));
	});

	it('leaves a transfer this browser started alone', async () => {
		trackDebridUploaderJob({
			id: 'job-1',
			hash: HASH,
			imdbId: 'tt1234567',
			createdAt: 1700000000000,
			adopted: false,
		});

		render(<TransfersPage />);

		await waitFor(() => expect(fetch).toHaveBeenCalled());
		expect(mockAddHashAsMagnet).not.toHaveBeenCalled();
	});

	it('does not add a second copy of a transfer already handed over', async () => {
		trackDebridUploaderJob({
			id: 'job-1',
			hash: HASH,
			imdbId: 'tt1234567',
			createdAt: 1700000000000,
			adopted: true,
			rdAdded: true,
		});

		render(<TransfersPage />);

		await waitFor(() => expect(fetch).toHaveBeenCalled());
		expect(mockAddHashAsMagnet).not.toHaveBeenCalled();
	});

	it('never hands over a transfer with no local entry', async () => {
		// The list now carries jobs this browser never saw. `adopted`/`rdAdded`
		// describe what *this* browser did, so a row with no entry was submitted
		// elsewhere and the service already delivered it to its own submitter —
		// adding it here would put a duplicate in the user's RD account.
		render(<TransfersPage />);

		await waitFor(() => expect(fetch).toHaveBeenCalled());
		expect(mockAddHashAsMagnet).not.toHaveBeenCalled();
	});
});
