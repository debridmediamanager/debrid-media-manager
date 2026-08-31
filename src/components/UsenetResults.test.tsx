import { UsenetResult } from '@/services/nzb2rd';
import type { Nzb2rdTransferSummary } from '@/utils/nzb2rd';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import UsenetResults, { buttonState, formatSize, sortResults } from './UsenetResults';

const toastSuccess = vi.fn();
const toastError = vi.fn();
const toastLoading = vi.fn((..._args: unknown[]) => 'toast-id');
const downloadCleanNzbMock = vi.fn();
vi.mock('@/utils/nzbDownload', () => ({
	downloadCleanNzb: (...args: unknown[]) => downloadCleanNzbMock(...args),
}));
vi.mock('react-hot-toast', () => ({
	__esModule: true,
	default: {
		success: (...args: unknown[]) => toastSuccess(...args),
		error: (...args: unknown[]) => toastError(...args),
		loading: (...args: unknown[]) => toastLoading(...args),
	},
}));

// A Usenet send is the same transfer as a TB → RD one from the user's side, so
// it wears the same `X → RD` prefix and rides one toast from submit onwards.
const USENET = 'Usenet → RD';

const RESULTS: UsenetResult[] = [
	{ id: 'a', title: 'Bravo.Release.1080p', size: 3 * 1024 ** 3 },
	{ id: 'b', title: 'Alpha.Release.2160p', size: 9 * 1024 ** 3 },
];

// The section makes two calls on open: the search, then a best-effort lookup of
// which releases already have a transfer.
function mockSearch(results: UsenetResult[] = RESULTS, transfers: unknown[] = []) {
	const fetchMock = vi.fn().mockImplementation((url: string) =>
		Promise.resolve({
			ok: true,
			json: async () => (url.includes('/registered') ? { transfers } : { results }),
		})
	);
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

const searchCalls = (mock: any) =>
	mock.mock.calls.filter((c: any[]) => String(c[0]).includes('/api/nzb2rd/search'));

/** Row titles in render order, so sorting is asserted on what the user sees. */
function renderedTitles(): string[] {
	return screen
		.getAllByRole('row')
		.slice(1) // header
		.map((row) => within(row).getAllByRole('cell')[0].textContent ?? '');
}

beforeEach(() => {
	vi.clearAllMocks();
	localStorage.clear();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('formatSize', () => {
	it('renders GB, and an unknown size as a dash', () => {
		expect(formatSize(6459339787)).toBe('6.02 GB');
		expect(formatSize(0)).toBe('—');
	});
});

describe('sortResults', () => {
	it('sorts by size and by title in both directions without mutating the input', () => {
		const input = [...RESULTS];
		expect(sortResults(input, 'size', 'desc').map((r) => r.id)).toEqual(['b', 'a']);
		expect(sortResults(input, 'size', 'asc').map((r) => r.id)).toEqual(['a', 'b']);
		expect(sortResults(input, 'title', 'asc').map((r) => r.id)).toEqual(['b', 'a']);
		expect(input.map((r) => r.id)).toEqual(['a', 'b']);
	});
});

describe('buttonState', () => {
	const none = new Set<string>();
	const noTransfers = new Map<string, Nzb2rdTransferSummary>();
	const marker = (over: Partial<Nzb2rdTransferSummary>): Map<string, Nzb2rdTransferSummary> =>
		new Map([
			[
				'a',
				{
					releaseId: 'a',
					jobId: 'job-1',
					infoHash: null,
					status: 'pending',
					...over,
				} as Nzb2rdTransferSummary,
			],
		]);

	it('offers Send for an untouched release', () => {
		expect(buttonState('a', none, none, noTransfers)).toMatchObject({
			kind: 'send',
			label: 'Send',
			disabled: false,
		});
	});

	it('shows in-flight and just-sent states for this browser', () => {
		expect(buttonState('a', new Set(['a']), none, noTransfers)).toMatchObject({
			kind: 'sending',
			disabled: true,
		});
		expect(buttonState('a', none, new Set(['a']), noTransfers)).toMatchObject({
			kind: 'sent',
			disabled: true,
		});
	});

	/** A finished fetch, as the reconcile hands it back: completed plus a hash. */
	const done = (over: Partial<Nzb2rdTransferSummary> = {}) =>
		marker({ status: 'completed', infoHash: 'd'.repeat(40), ...over });

	// This button used to be a dead end. The content was in Real-Debrid under a
	// hash the marker already stored, and the server has always answered a send
	// for it by adding that hash to the caller's own account — but the row said
	// "In RD" (true only of whoever submitted it) and refused the click.
	it("offers another user's completed fetch as an add to your own library", () => {
		expect(buttonState('a', none, none, done())).toMatchObject({
			kind: 'cached',
			label: 'Add to RD',
			disabled: false,
		});
	});

	// Nothing to hand over, so there is nothing to add — and the server agrees:
	// its dedup check answers false for this record and takes a fresh fetch.
	it('falls back to Send for a completed job with no hash', () => {
		expect(buttonState('a', none, none, marker({ status: 'completed' }))).toMatchObject({
			kind: 'send',
			label: 'Send',
			disabled: false,
		});
	});

	it('marks a release this browser has already added, so a second click cannot double it', () => {
		expect(buttonState('a', none, none, done(), new Set(['a']))).toMatchObject({
			kind: 'added',
			label: 'Added',
			disabled: true,
		});
	});

	// A resubmit was always allowed server-side; the row just never said the last
	// attempt had failed, or why.
	it('offers a retry carrying the reason the last attempt failed', () => {
		expect(
			buttonState(
				'a',
				none,
				none,
				marker({ status: 'failed', error: 'RD refused the credentials' })
			)
		).toMatchObject({
			kind: 'failed',
			label: 'Retry',
			detail: 'RD refused the credentials',
			title: 'Last attempt failed: RD refused the credentials',
			disabled: false,
		});
	});

	it('still offers a retry when nzb2rd gave no reason', () => {
		expect(buttonState('a', none, none, marker({ status: 'failed' }))).toMatchObject({
			kind: 'failed',
			label: 'Retry',
			disabled: false,
		});
		expect(buttonState('a', none, none, marker({ status: 'failed' })).detail).toBeUndefined();
	});

	// The reason this exists: a marker only says `pending`, and "Running" read as
	// work in progress. Measured 2026-08-29 against the live queue, 670 of the 683
	// unfinished jobs had not started — none of them had a `started_at` or a
	// single progress byte — while 13 were genuinely working. So the overwhelming
	// majority of "Running" rows were releases sitting in a line up to 8 days deep.
	it('says a queued job is queued, with its place in line', () => {
		expect(
			buttonState(
				'a',
				none,
				none,
				marker({ progress: { status: 'pending', queue: { position: 479, waiting: 670 } } })
			)
		).toMatchObject({
			kind: 'running',
			phase: 'queued',
			label: 'Queued',
			detail: '479th of 670 in line',
			disabled: true,
		});
	});

	it('says next in line rather than 1st of 1', () => {
		expect(
			buttonState(
				'a',
				none,
				none,
				marker({ progress: { status: 'pending', queue: { position: 1, waiting: 1 } } })
			).detail
		).toBe('next in line');
	});

	it('shows the Usenet pass as a download with its own percentage', () => {
		expect(
			buttonState(
				'a',
				none,
				none,
				marker({
					progress: {
						status: 'hashing',
						done_bytes: 5_985_088_778,
						total_bytes: 9_811_477_047,
					},
				})
			)
		).toMatchObject({
			kind: 'running',
			phase: 'downloading',
			label: 'Downloading',
			detail: '61%',
			disabled: true,
		});
	});

	// `uploading` is Real-Debrid pulling the bytes from us, which reads backwards
	// to whoever is watching their own transfer.
	it("names RD's own pull from the user's side", () => {
		expect(
			buttonState(
				'a',
				none,
				none,
				marker({
					progress: {
						status: 'uploading',
						status_message: 'RD: downloading 42% @ 11.6 MB/s',
					},
				})
			)
		).toMatchObject({
			phase: 'importing',
			label: 'Real-Debrid downloading',
			detail: '42%',
		});
	});

	// Only eight markers are re-checked per request, and nzb2rd can be down, so a
	// marker without live fields has to stay honest rather than claim a phase.
	it('falls back to a phase-free label when the job could not be re-checked', () => {
		expect(buttonState('a', none, none, marker({}))).toMatchObject({
			kind: 'running',
			label: 'In progress',
			phase: null,
			disabled: true,
		});
		expect(buttonState('a', none, none, marker({})).detail).toBeUndefined();
	});

	it('lets this browser own state win over the shared record', () => {
		expect(buttonState('a', new Set(['a']), none, done()).kind).toBe('sending');
	});

	// Same request either way, but "Sending" would be a lie: no NZB is pulled and
	// nothing joins the queue, the stored hash just goes into the caller's account.
	it('says adding, not sending, while a finished release is being claimed', () => {
		expect(buttonState('a', new Set(['a']), none, done())).toMatchObject({
			kind: 'sending',
			label: 'Adding',
		});
		expect(buttonState('a', new Set(['a']), none, noTransfers).label).toBe('Sending');
	});
});

describe('UsenetResults — claiming a finished release', () => {
	const COMPLETED = {
		releaseId: 'a',
		jobId: 'job-1',
		infoHash: 'd'.repeat(40),
		status: 'completed' as const,
	};

	/** Search, then the marker lookup, then whatever the send POST answers. */
	function mockClaim(jobResponse: unknown) {
		const fetchMock = vi.fn().mockImplementation((url: string) => {
			if (String(url).includes('/registered')) {
				return Promise.resolve({
					ok: true,
					json: async () => ({ transfers: [COMPLETED] }),
				});
			}
			if (String(url).includes('/api/nzb2rd/jobs')) {
				return Promise.resolve({ ok: true, json: async () => jobResponse });
			}
			return Promise.resolve({ ok: true, json: async () => ({ results: RESULTS }) });
		});
		vi.stubGlobal('fetch', fetchMock);
		return fetchMock;
	}

	const openAndFind = async (name: RegExp) => {
		render(<UsenetResults imdbId="tt1418646" rdKey="rd-key" />);
		await userEvent.click(screen.getByRole('button', { name: /usenet/i }));
		return await screen.findByRole('button', { name });
	};

	// The whole point of the change: the content is already in Real-Debrid, and
	// one click puts it in *this* user's account without a second Usenet fetch.
	it('adds the stored hash to the caller and settles the row on Added', async () => {
		const fetchMock = mockClaim({
			duplicate: 'completed',
			infoHash: COMPLETED.infoHash,
			jobId: 'job-1',
			added: true,
		});

		await userEvent.click(await openAndFind(/add to rd/i));

		await waitFor(() => expect(screen.getByRole('button', { name: /added/i })).toBeDisabled());
		const posts = fetchMock.mock.calls.filter((c: any[]) =>
			String(c[0]).includes('/api/nzb2rd/jobs')
		);
		expect(posts).toHaveLength(1);
		expect(JSON.parse(posts[0][1].body)).toMatchObject({ id: 'a', imdbId: 'tt1418646' });
		expect(toastSuccess).toHaveBeenCalledWith(
			expect.stringContaining('it is in your Real-Debrid library'),
			expect.anything()
		);
	});

	// Real-Debrid does not dedupe an addMagnet by hash, so a row that has landed
	// must stop accepting clicks or it makes a second library entry.
	it('refuses a second click once it has landed', async () => {
		const fetchMock = mockClaim({
			duplicate: 'completed',
			infoHash: COMPLETED.infoHash,
			jobId: 'job-1',
			added: true,
		});

		await userEvent.click(await openAndFind(/add to rd/i));
		const added = await screen.findByRole('button', { name: /added/i });
		await userEvent.click(added);

		expect(
			fetchMock.mock.calls.filter((c: any[]) => String(c[0]).includes('/api/nzb2rd/jobs'))
		).toHaveLength(1);
	});

	// An add that did not land must stay clickable — settling it on "Added" would
	// tell the user they have content they do not.
	it('leaves the row clickable when the add failed', async () => {
		mockClaim({
			duplicate: 'completed',
			infoHash: COMPLETED.infoHash,
			jobId: 'job-1',
			added: false,
		});

		await userEvent.click(await openAndFind(/add to rd/i));

		await waitFor(() =>
			expect(screen.getByRole('button', { name: /add to rd/i })).toBeEnabled()
		);
		expect(screen.queryByRole('button', { name: /added/i })).not.toBeInTheDocument();
	});
});

describe('UsenetResults', () => {
	it('starts collapsed and does not hit the indexer until opened', () => {
		const fetchMock = mockSearch();
		render(<UsenetResults imdbId="tt1418646" rdKey="rd-key" />);

		expect(screen.getByRole('button', { name: /usenet/i })).toHaveAttribute(
			'aria-expanded',
			'false'
		);
		expect(screen.queryByRole('table')).not.toBeInTheDocument();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('loads results on first open, biggest first', async () => {
		const fetchMock = mockSearch();
		render(<UsenetResults imdbId="tt1418646" rdKey="rd-key" />);

		await userEvent.click(screen.getByRole('button', { name: /usenet/i }));

		await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
		expect(searchCalls(fetchMock)[0][0]).toBe('/api/nzb2rd/search?imdbId=tt1418646');
		expect(renderedTitles()).toEqual(['Alpha.Release.2160p', 'Bravo.Release.1080p']);
		expect(screen.getByText('9.00 GB')).toBeInTheDocument();
	});

	it('passes the season through for a show', async () => {
		const fetchMock = mockSearch();
		render(<UsenetResults imdbId="tt0944947" seasonNum={3} rdKey="rd-key" />);

		await userEvent.click(screen.getByRole('button', { name: /usenet/i }));

		await waitFor(() =>
			expect(searchCalls(fetchMock)[0][0]).toBe(
				'/api/nzb2rd/search?imdbId=tt0944947&seasonNum=3'
			)
		);
	});

	it('refetches nothing when reopened, since the results are already loaded', async () => {
		const fetchMock = mockSearch();
		render(<UsenetResults imdbId="tt1418646" rdKey="rd-key" />);
		const toggle = screen.getByRole('button', { name: /usenet/i });

		await userEvent.click(toggle);
		await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
		await userEvent.click(toggle);
		await userEvent.click(toggle);

		expect(screen.getByRole('table')).toBeInTheDocument();
		expect(searchCalls(fetchMock)).toHaveLength(1);
	});

	it('sorts by the clicked column and flips direction on a second click', async () => {
		mockSearch();
		render(<UsenetResults imdbId="tt1418646" rdKey="rd-key" />);
		await userEvent.click(screen.getByRole('button', { name: /usenet/i }));
		await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());

		await userEvent.click(screen.getByRole('button', { name: /^release/i }));
		expect(renderedTitles()).toEqual(['Alpha.Release.2160p', 'Bravo.Release.1080p']);

		await userEvent.click(screen.getByRole('button', { name: /^release/i }));
		expect(renderedTitles()).toEqual(['Bravo.Release.1080p', 'Alpha.Release.2160p']);

		await userEvent.click(screen.getByRole('button', { name: /^size/i }));
		expect(renderedTitles()).toEqual(['Alpha.Release.2160p', 'Bravo.Release.1080p']);
	});

	it('sends a release to nzb2rd with the user RD key and marks the row sent', async () => {
		const fetchMock = mockSearch();
		render(<UsenetResults imdbId="tt1418646" rdKey="rd-key" />);
		await userEvent.click(screen.getByRole('button', { name: /usenet/i }));
		await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());

		fetchMock.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ id: 'job-1', status: 'pending' }),
		});
		await userEvent.click(screen.getAllByRole('button', { name: /^send$/i })[0]);

		await waitFor(() =>
			expect(toastLoading).toHaveBeenCalledWith(
				`${USENET}: transfer started — track it on the Transfers page.`,
				expect.objectContaining({ id: 'toast-id' })
			)
		);
		expect(fetchMock).toHaveBeenCalledWith('/api/nzb2rd/jobs', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				id: 'b',
				title: 'Alpha.Release.2160p',
				imdbId: 'tt1418646',
				rdKey: 'rd-key',
				// Null here because this test's localStorage holds no OAuth triple.
				// When one is present it rides along, so a job that waits days in
				// nzb2rd's queue can refresh the token rather than presenting the
				// expired one and failing as `401 bad_token`.
				oauth: null,
				// The page this was started from. Stored server-side against the job
				// id, because the Transfers page is server-driven and nzb2rd records
				// nothing that could link a row back to the content.
				returnPath: '/movie/tt1418646',
			}),
		});
		expect(await screen.findByRole('button', { name: /sent/i })).toBeDisabled();
	});

	// The `401 bad_token` fix, from the browser end: an access token that dies
	// 24h after login is useless to a job that waits days in nzb2rd's queue, so
	// the long-lived triple has to travel with it.
	it('sends the stored OAuth credentials alongside the access token', async () => {
		localStorage.setItem('rd:clientId', JSON.stringify('CID'));
		localStorage.setItem('rd:clientSecret', JSON.stringify('CSEC'));
		localStorage.setItem('rd:refreshToken', JSON.stringify('CREF'));

		const fetchMock = mockSearch();
		render(<UsenetResults imdbId="tt1418646" rdKey="rd-key" />);
		await userEvent.click(screen.getByRole('button', { name: /usenet/i }));
		await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());

		fetchMock.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ id: 'job-1', status: 'pending' }),
		});
		await userEvent.click(screen.getAllByRole('button', { name: /^send$/i })[0]);

		await waitFor(() => {
			const send = fetchMock.mock.calls.find((call) => call[0] === '/api/nzb2rd/jobs');
			expect(JSON.parse(send?.[1].body).oauth).toEqual({
				clientId: 'CID',
				clientSecret: 'CSEC',
				refreshToken: 'CREF',
			});
		});
	});

	it('surfaces a send failure and leaves the row re-sendable', async () => {
		const fetchMock = mockSearch();
		render(<UsenetResults imdbId="tt1418646" rdKey="rd-key" />);
		await userEvent.click(screen.getByRole('button', { name: /usenet/i }));
		await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());

		fetchMock.mockResolvedValueOnce({
			ok: false,
			status: 502,
			json: async () => ({ error: 'nzb2rd service unreachable' }),
		});
		await userEvent.click(screen.getAllByRole('button', { name: /^send$/i })[0]);

		await waitFor(() =>
			expect(toastError).toHaveBeenCalledWith(
				`${USENET}: nzb2rd service unreachable`,
				expect.anything()
			)
		);
		expect(screen.getAllByRole('button', { name: /^send$/i })[0]).toBeEnabled();
	});

	it('refuses to send without a Real-Debrid key', async () => {
		const fetchMock = mockSearch();
		render(<UsenetResults imdbId="tt1418646" rdKey={null} />);
		await userEvent.click(screen.getByRole('button', { name: /usenet/i }));
		await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());

		await userEvent.click(screen.getAllByRole('button', { name: /^send$/i })[0]);

		expect(toastError).toHaveBeenCalledWith(
			'Log in with Real-Debrid to send Usenet releases',
			expect.anything()
		);
		expect(
			fetchMock.mock.calls.filter((c: any[]) => String(c[0]).includes('/jobs'))
		).toHaveLength(0);
	});

	it('shows a retry when the search fails', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue({ ok: true, json: async () => ({ transfers: [] }) })
			.mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({}) });
		vi.stubGlobal('fetch', fetchMock);
		render(<UsenetResults imdbId="tt1418646" rdKey="rd-key" />);

		await userEvent.click(screen.getByRole('button', { name: /usenet/i }));

		const retry = await screen.findByRole('button', { name: /retry/i });
		fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ results: RESULTS }) });
		await userEvent.click(retry);

		await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
	});

	it('renders nothing until the router has an imdb id', () => {
		const fetchMock = mockSearch();
		const { container } = render(<UsenetResults imdbId="" rdKey="rd-key" />);

		expect(container).toBeEmptyDOMElement();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('offers a release someone already fetched as an add, never a second fetch', async () => {
		mockSearch(RESULTS, [
			{ releaseId: 'b', status: 'completed', infoHash: 'h', jobId: 'j' },
			{ releaseId: 'a', status: 'pending', infoHash: null, jobId: 'j2' },
		]);
		render(<UsenetResults imdbId="tt1418646" rdKey="rd-key" />);
		await userEvent.click(screen.getByRole('button', { name: /usenet/i }));
		await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());

		expect(await screen.findByRole('button', { name: /add to rd/i })).toBeEnabled();
		expect(screen.getByRole('button', { name: /in progress/i })).toBeDisabled();
		// Enabled, but not a Send: clicking it claims the stored hash rather than
		// spending indexer quota and block-account bytes on the same release twice.
		expect(screen.queryByRole('button', { name: /^send$/i })).not.toBeInTheDocument();
	});

	// The distinction the row exists to make: one of these is finished and one is
	// sitting in a queue that has run eight days deep, and both used to read as a
	// green-adjacent disabled button.
	it('separates a finished release from one still waiting in line', async () => {
		mockSearch(RESULTS, [
			{ releaseId: 'b', status: 'completed', infoHash: 'h', jobId: 'j' },
			{
				releaseId: 'a',
				status: 'pending',
				infoHash: null,
				jobId: 'j2',
				progress: { status: 'pending', queue: { position: 12, waiting: 670 } },
			},
		]);
		render(<UsenetResults imdbId="tt1418646" rdKey="rd-key" />);
		await userEvent.click(screen.getByRole('button', { name: /usenet/i }));
		await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());

		expect(await screen.findByRole('button', { name: /add to rd/i })).toBeEnabled();
		const queued = screen.getByRole('button', { name: /queued/i });
		expect(queued).toBeDisabled();
		expect(queued).toHaveTextContent('12th of 670 in line');
	});

	it('shows how far along a release being fetched right now is', async () => {
		mockSearch(RESULTS, [
			{
				releaseId: 'a',
				status: 'pending',
				infoHash: null,
				jobId: 'j2',
				progress: { status: 'hashing', done_bytes: 3, total_bytes: 4 },
			},
		]);
		render(<UsenetResults imdbId="tt1418646" rdKey="rd-key" />);
		await userEvent.click(screen.getByRole('button', { name: /usenet/i }));
		await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());

		const row = await screen.findByRole('button', { name: /downloading/i });
		expect(row).toHaveTextContent('75%');
		expect(row).toBeDisabled();
	});

	it('tracks a started job so the Transfers page can follow it', async () => {
		const fetchMock = mockSearch();
		render(<UsenetResults imdbId="tt0944947" seasonNum={2} rdKey="rd-key" />);
		await userEvent.click(screen.getByRole('button', { name: /usenet/i }));
		await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());

		fetchMock.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ id: 'job-1', status: 'pending' }),
		});
		await userEvent.click(screen.getAllByRole('button', { name: /^send$/i })[0]);
		await waitFor(() => expect(toastLoading).toHaveBeenCalled());

		const tracked = JSON.parse(localStorage.getItem('nzb2rd:jobs') ?? '[]');
		expect(tracked).toHaveLength(1);
		expect(tracked[0]).toMatchObject({
			id: 'job-1',
			releaseId: 'b',
			imdbId: 'tt0944947',
			returnPath: '/show/tt0944947/2',
		});
	});

	it('reports an already-finished release as added to your own library', async () => {
		const fetchMock = mockSearch();
		render(<UsenetResults imdbId="tt1418646" rdKey="rd-key" />);
		await userEvent.click(screen.getByRole('button', { name: /usenet/i }));
		await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());

		fetchMock.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ duplicate: 'completed', infoHash: 'h', jobId: 'j', added: true }),
		});
		await userEvent.click(screen.getAllByRole('button', { name: /^send$/i })[0]);

		expect(await screen.findByRole('button', { name: /added/i })).toBeDisabled();
		await waitFor(() =>
			expect(toastSuccess).toHaveBeenCalledWith(
				`${USENET}: already fetched — it is in your Real-Debrid library.`,
				expect.anything()
			)
		);
		// nothing to follow: it is already done
		expect(localStorage.getItem('nzb2rd:jobs')).toBeNull();
	});

	// Otherwise this browser has no way to learn the job finished, and the
	// completion path is what puts the content in *this* user's account.
	it("follows someone else's in-flight job so the result reaches this account", async () => {
		const fetchMock = mockSearch();
		render(<UsenetResults imdbId="tt1418646" rdKey="rd-key" />);
		await userEvent.click(screen.getByRole('button', { name: /usenet/i }));
		await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());

		fetchMock.mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				duplicate: 'in_progress',
				infoHash: null,
				jobId: 'job-A',
				queued: true,
			}),
		});
		await userEvent.click(screen.getAllByRole('button', { name: /^send$/i })[0]);

		// The duplicate reply says a job exists, not where it stands, so the row
		// stays vague until the next lookup places it in the queue.
		expect(await screen.findByRole('button', { name: /in progress/i })).toBeDisabled();
		const tracked = JSON.parse(localStorage.getItem('nzb2rd:jobs') ?? '[]');
		expect(tracked).toHaveLength(1);
		expect(tracked[0]).toMatchObject({ id: 'job-A', releaseId: 'b' });
	});

	it('asks for packs by name on a show, and labels the ones it finds', async () => {
		const fetchMock = mockSearch([
			{ id: 'p', title: 'Show.S02.COMPLETE.1080p', size: 40 * 1024 ** 3, isPack: true },
			{ id: 'e', title: 'Show.S02E01.1080p', size: 3 * 1024 ** 3 },
		]);
		render(<UsenetResults imdbId="tt0944947" seasonNum={2} title="Show" rdKey="rd-key" />);

		await userEvent.click(screen.getByRole('button', { name: /usenet/i }));
		await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());

		expect(searchCalls(fetchMock)[0][0]).toBe(
			'/api/nzb2rd/search?imdbId=tt0944947&seasonNum=2&title=Show'
		);
		expect(screen.getByText('Season pack')).toBeInTheDocument();
		// only the pack row is labelled
		expect(screen.getAllByText('Season pack')).toHaveLength(1);
	});

	it('does not ask for packs on a movie, which has no seasons', async () => {
		const fetchMock = mockSearch();
		render(<UsenetResults imdbId="tt1418646" title="Some Movie" rdKey="rd-key" />);

		await userEvent.click(screen.getByRole('button', { name: /usenet/i }));
		await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());

		expect(searchCalls(fetchMock)[0][0]).toBe('/api/nzb2rd/search?imdbId=tt1418646');
		expect(screen.queryByText('Season pack')).not.toBeInTheDocument();
	});

	it('says so when the indexer has nothing', async () => {
		mockSearch([]);
		render(<UsenetResults imdbId="tt1418646" rdKey="rd-key" />);

		await userEvent.click(screen.getByRole('button', { name: /usenet/i }));

		expect(await screen.findByText(/no usenet results found/i)).toBeInTheDocument();
	});
});

/**
 * Saving the NZB instead of sending it. The file is cleaned server-side, so the
 * row's job is only to ask for it and say what came off.
 */
describe('UsenetResults NZB download', () => {
	const openPanel = async (rdKey: string | null = 'rd-key') => {
		mockSearch();
		render(<UsenetResults imdbId="tt1418646" rdKey={rdKey} />);
		await userEvent.click(screen.getByRole('button', { name: /usenet/i }));
		await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
	};

	const downloadButtons = () => screen.getAllByRole('button', { name: /download clean nzb/i });

	it('asks for the release under the row it sits in', async () => {
		downloadCleanNzbMock.mockResolvedValue({ name: 'Alpha.Release.2160p.nzb', removed: [] });
		await openPanel();

		await userEvent.click(downloadButtons()[0]);

		// Sorted biggest-first, so the top row is Alpha.
		expect(downloadCleanNzbMock).toHaveBeenCalledWith('b', 'Alpha.Release.2160p');
	});

	it('names what was stripped, which is the point of the button', async () => {
		downloadCleanNzbMock.mockResolvedValue({
			name: 'Alpha.Release.2160p.nzb',
			removed: ['<meta type="tag"> (0a624180.278)', 'DOCTYPE'],
		});
		await openPanel();

		await userEvent.click(downloadButtons()[0]);

		await waitFor(() =>
			expect(toastSuccess).toHaveBeenCalledWith(
				expect.stringContaining('<meta type="tag"> (0a624180.278)'),
				expect.anything()
			)
		);
	});

	// Claiming a clean-up that found nothing would be a lie about the file.
	it('says plainly when there was nothing identifying to remove', async () => {
		downloadCleanNzbMock.mockResolvedValue({ name: 'Alpha.nzb', removed: [] });
		await openPanel();

		await userEvent.click(downloadButtons()[0]);

		await waitFor(() =>
			expect(toastSuccess).toHaveBeenCalledWith(
				expect.stringContaining('nothing identifying'),
				expect.anything()
			)
		);
	});

	it('reports a failure instead of leaving the row spinning', async () => {
		downloadCleanNzbMock.mockRejectedValue(new Error('Could not download the NZB'));
		await openPanel();

		await userEvent.click(downloadButtons()[0]);

		await waitFor(() =>
			expect(toastError).toHaveBeenCalledWith(
				expect.stringContaining('Could not download the NZB'),
				expect.anything()
			)
		);
		expect(downloadButtons()[0]).toBeEnabled();
	});

	// Unlike Send, this needs no account: it goes to the user's own SABnzbd.
	it('works without a Real-Debrid login', async () => {
		downloadCleanNzbMock.mockResolvedValue({ name: 'Alpha.nzb', removed: [] });
		await openPanel(null);

		await userEvent.click(downloadButtons()[0]);

		expect(downloadCleanNzbMock).toHaveBeenCalled();
		expect(toastError).not.toHaveBeenCalled();
	});

	// A release someone else is still fetching disables Send. It is nonetheless
	// one this user can save a clean copy of right now.
	it('stays available on a row whose Send is disabled', async () => {
		downloadCleanNzbMock.mockResolvedValue({ name: 'Alpha.nzb', removed: [] });
		mockSearch(RESULTS, [
			{ releaseId: 'b', jobId: 'job-1', infoHash: null, status: 'pending' },
		]);
		render(<UsenetResults imdbId="tt1418646" rdKey="rd-key" />);
		await userEvent.click(screen.getByRole('button', { name: /usenet/i }));
		await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
		await waitFor(() =>
			expect(screen.getByRole('button', { name: /in progress/i })).toBeDisabled()
		);

		expect(downloadButtons()[0]).toBeEnabled();
		await userEvent.click(downloadButtons()[0]);
		expect(downloadCleanNzbMock).toHaveBeenCalledWith('b', 'Alpha.Release.2160p');
	});
});
