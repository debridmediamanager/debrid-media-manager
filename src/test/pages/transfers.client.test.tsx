import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
let currentTbKey: string | null = 'test-tb-key';
vi.mock('@/hooks/auth', () => ({
	__esModule: true,
	useRealDebridAccessToken: () => [currentRdKey, false, false],
	useTorBoxAccessToken: () => currentTbKey,
}));

const mockAddHashAsMagnet = vi.fn().mockResolvedValue('rd-torrent-id');
const mockSelectFiles = vi.fn().mockResolvedValue(undefined);
vi.mock('@/services/realDebrid', () => ({
	__esModule: true,
	addHashAsMagnet: (...args: any[]) => mockAddHashAsMagnet(...args),
	selectFiles: (...args: any[]) => mockSelectFiles(...args),
}));

import TransfersPage from '@/pages/transfers';
import uncachedJob from '@/test/fixtures/contentRequests/job-failed-uncached.json';
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
	currentTbKey = 'test-tb-key';
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

// Cancelling is the only way a row leaves this list, and the button was rendered
// only while a row was *not* terminal — so a failed row could never be removed.
// That is not merely untidy: a failed Usenet job leaves a `nzbrd:` marker that
// shows a disabled "Running" button on the release for every user, and this
// delete is the one call that clears it.
describe('Transfers page — clearing a terminal row', () => {
	const failedNzb = {
		source: 'nzb2rd',
		id: 'job-9',
		status: 'failed',
		releaseId: 'release-9',
		createdAt: 1700000000000,
		name: 'Pirate For The Sea',
		error: 'Real-Debrid refused this job saved credentials',
	};

	beforeEach(() => {
		vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
	});

	it('offers a clear button on a failed row and deletes the job with its release id', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(listResponse([failedNzb])));
		render(<TransfersPage />);
		await waitFor(() => expect(screen.getByText('Pirate For The Sea')).toBeInTheDocument());

		fireEvent.click(screen.getByTitle('Clear transfer'));

		await waitFor(() =>
			expect(fetch).toHaveBeenCalledWith(
				'/api/nzb2rd/jobs/job-9?releaseId=release-9',
				expect.objectContaining({ method: 'DELETE' })
			)
		);
		await waitFor(() =>
			expect(screen.queryByText('Pirate For The Sea')).not.toBeInTheDocument()
		);
	});

	it('still calls an in-flight row a cancel', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(listResponse([{ ...failedNzb, status: 'fetching' }]))
		);
		render(<TransfersPage />);
		await waitFor(() => expect(screen.getByText('Pirate For The Sea')).toBeInTheDocument());

		expect(screen.getByTitle('Cancel transfer')).toBeInTheDocument();
		expect(screen.queryByTitle('Clear transfer')).not.toBeInTheDocument();
	});

	it('does nothing when the confirm is declined', async () => {
		vi.stubGlobal('confirm', vi.fn().mockReturnValue(false));
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(listResponse([failedNzb])));
		render(<TransfersPage />);
		await waitFor(() => expect(screen.getByText('Pirate For The Sea')).toBeInTheDocument());

		fireEvent.click(screen.getByTitle('Clear transfer'));

		expect(fetch).not.toHaveBeenCalledWith(
			expect.stringContaining('/api/nzb2rd/jobs/'),
			expect.anything()
		);
	});
});

// Card 109: a failed or cancelled TB → RD send stayed "in progress" for good and
// could not be sent again from anywhere. A failed row is where the user sees the
// failure, so it is where the retry lives. The job is a real failed one from
// debrid02, as `/api/transfers` maps it.
describe('Transfers page — retrying a failed TorBox transfer', () => {
	const failedTb = {
		source: 'debrid',
		id: uncachedJob.id,
		status: 'failed',
		error: uncachedJob.error,
		createdAt: Date.parse(`${uncachedJob.created_at}Z`),
		hash: 'abb28cb1dc25c1e2fa27aac9d1fe70d4c02be8f2',
		imdbId: uncachedJob.imdb_id,
		title: 'The Failed Release',
		returnPath: '/movie/tt1228322',
	};

	/** The list, and the uploader's answer to a resubmission of the release. */
	const serve = (transfers: unknown[]) =>
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) =>
				url === '/api/debrid-uploader/jobs'
					? {
							ok: true,
							status: 200,
							json: async () => ({
								duplicate: 'completed',
								rewrittenHash: REWRITTEN,
								jobId: 'job-retry',
								addedToRd: true,
							}),
						}
					: listResponse(transfers)
			)
		);

	it('sends the release again with this browser’s keys', async () => {
		serve([failedTb]);
		render(<TransfersPage />);
		await waitFor(() => expect(screen.getByText('The Failed Release')).toBeInTheDocument());

		fireEvent.click(screen.getByTitle('Retry transfer'));

		await waitFor(() =>
			expect(fetch).toHaveBeenCalledWith(
				'/api/debrid-uploader/jobs',
				expect.objectContaining({ method: 'POST' })
			)
		);
		const submit = vi
			.mocked(fetch as any)
			.mock.calls.find(([url]: [string]) => url === '/api/debrid-uploader/jobs');
		expect(JSON.parse(submit[1].body)).toMatchObject({
			hash: failedTb.hash,
			imdbId: 'tt1228322',
			rdKey: 'test-rd-key',
			tbKey: 'test-tb-key',
			title: 'The Failed Release',
			returnPath: '/movie/tt1228322',
		});
	});

	it('is not offered without a TorBox key to source it from', async () => {
		currentTbKey = null;
		serve([failedTb]);
		render(<TransfersPage />);
		await waitFor(() => expect(screen.getByText('The Failed Release')).toBeInTheDocument());

		expect(screen.queryByTitle('Retry transfer')).not.toBeInTheDocument();
	});

	it('is not offered once a newer transfer of the release is listed', async () => {
		serve([
			{
				...failedTb,
				id: 'job-new',
				status: 'downloading',
				createdAt: failedTb.createdAt + 1,
			},
			failedTb,
		]);
		render(<TransfersPage />);
		await waitFor(() => expect(screen.getAllByText('The Failed Release')).toHaveLength(2));

		expect(screen.queryByTitle('Retry transfer')).not.toBeInTheDocument();
	});

	it('is not offered on a running, completed or Usenet row', async () => {
		serve([
			{ ...failedTb, id: 'a', hash: 'c'.repeat(40), status: 'uploading', title: 'Running' },
			{ ...failedTb, id: 'b', hash: 'd'.repeat(40), status: 'completed', title: 'Done' },
			{ ...failedTb, id: 'c', source: 'nzb2rd', hash: undefined, title: 'Usenet' },
		]);
		render(<TransfersPage />);
		await waitFor(() => expect(screen.getByText('Usenet')).toBeInTheDocument());

		expect(screen.queryByTitle('Retry transfer')).not.toBeInTheDocument();
	});
});

// Card 110: the page showed the newest 100 transfers and nothing older, so an
// account that had queued hundreds of single episodes could not see whether the
// earlier ones had failed.
describe('Transfers page — older pages', () => {
	const page = (prefix: string, count: number) =>
		Array.from({ length: count }, (_, i) =>
			row({ id: `${prefix}-${i}`, name: `${prefix} ${i}`, createdAt: 1700000000000 - i })
		);

	const pagedResponse = (transfers: unknown[], next: string | null) => ({
		ok: true,
		status: 200,
		json: async () => ({ transfers, degraded: [], next }),
	});

	/** The first page links to a second, which is the last. */
	const serveTwoPages = () =>
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) =>
				url === '/api/transfers?cursor=nzb2rd.100'
					? pagedResponse(page('Older', 3), null)
					: pagedResponse(page('Newest', 100), 'nzb2rd.100')
			)
		);

	it('offers the next page and shows it in place of the first', async () => {
		serveTwoPages();
		render(<TransfersPage />);
		await waitFor(() => expect(screen.getByText('Newest 99')).toBeInTheDocument());

		fireEvent.click(screen.getAllByTitle('Older transfers')[0]);

		await waitFor(() => expect(screen.getByText('Older 0')).toBeInTheDocument());
		expect(fetch).toHaveBeenCalledWith('/api/transfers?cursor=nzb2rd.100', {
			headers: { 'x-rd-api-key': 'test-rd-key' },
		});
		expect(screen.queryByText('Newest 0')).not.toBeInTheDocument();
		expect(screen.getAllByText('Showing 101–103')[0]).toBeInTheDocument();
		// The last page has nothing older to offer.
		for (const button of screen.getAllByTitle('Older transfers')) {
			expect(button).toBeDisabled();
		}
	});

	it('keeps refreshing the page being read, not the first one', async () => {
		serveTwoPages();
		render(<TransfersPage />);
		await waitFor(() => expect(screen.getByText('Newest 99')).toBeInTheDocument());
		fireEvent.click(screen.getAllByTitle('Older transfers')[0]);
		await waitFor(() => expect(screen.getByText('Older 0')).toBeInTheDocument());
		vi.mocked(fetch as any).mockClear();

		fireEvent.click(screen.getByTitle('Refresh all'));

		await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
		expect((fetch as any).mock.calls[0][0]).toBe('/api/transfers?cursor=nzb2rd.100');
		expect(screen.getByText('Older 0')).toBeInTheDocument();
	});

	it('goes back to the newer page', async () => {
		serveTwoPages();
		render(<TransfersPage />);
		await waitFor(() => expect(screen.getByText('Newest 99')).toBeInTheDocument());
		fireEvent.click(screen.getAllByTitle('Older transfers')[0]);
		await waitFor(() => expect(screen.getByText('Older 0')).toBeInTheDocument());

		fireEvent.click(screen.getAllByTitle('Newer transfers')[0]);

		await waitFor(() => expect(screen.getByText('Newest 0')).toBeInTheDocument());
		expect(screen.queryByText('Older 0')).not.toBeInTheDocument();
		expect(screen.getAllByText('Showing 1–100')[0]).toBeInTheDocument();
	});

	it('does not let a late answer for the page just left replace the one now shown', async () => {
		// A 5s tick that left before the page was turned answers for the old page.
		let answerLate: (value: unknown) => void = () => {};
		serveTwoPages();
		render(<TransfersPage />);
		await waitFor(() => expect(screen.getByText('Newest 99')).toBeInTheDocument());
		fireEvent.click(screen.getAllByTitle('Older transfers')[0]);
		await waitFor(() => expect(screen.getByText('Older 0')).toBeInTheDocument());

		vi.mocked(fetch as any).mockImplementationOnce(
			() => new Promise((resolve) => (answerLate = resolve))
		);
		fireEvent.click(screen.getByTitle('Refresh all'));
		fireEvent.click(screen.getAllByTitle('Newer transfers')[0]);
		await waitFor(() => expect(screen.getByText('Newest 0')).toBeInTheDocument());

		answerLate(pagedResponse(page('Older', 3), null));
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(screen.getByText('Newest 0')).toBeInTheDocument();
		expect(screen.queryByText('Older 0')).not.toBeInTheDocument();
	});

	it('shows no page controls when everything fits on one page', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(pagedResponse(page('Only', 3), null)));
		render(<TransfersPage />);
		await waitFor(() => expect(screen.getByText('Only 2')).toBeInTheDocument());

		expect(screen.queryByTitle('Older transfers')).not.toBeInTheDocument();
		expect(screen.queryByTitle('Newer transfers')).not.toBeInTheDocument();
	});
});
