import { UsenetResult } from '@/services/nzb2rd';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import UsenetResults, { buttonState, formatSize, sortResults } from './UsenetResults';

const toastSuccess = vi.fn();
const toastError = vi.fn();
const toastLoading = vi.fn((..._args: unknown[]) => 'toast-id');
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
	const noTransfers = new Map<string, 'pending' | 'completed'>();

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

	it("shows another user's completed fetch as cached, not sendable", () => {
		expect(buttonState('a', none, none, new Map([['a', 'completed' as const]]))).toMatchObject({
			kind: 'cached',
			label: 'In RD',
			disabled: true,
		});
	});

	it("shows another user's running fetch as running", () => {
		expect(buttonState('a', none, none, new Map([['a', 'pending' as const]]))).toMatchObject({
			kind: 'running',
			label: 'Running',
			disabled: true,
		});
	});

	it('lets this browser own state win over the shared record', () => {
		const shared = new Map([['a', 'completed' as const]]);
		expect(buttonState('a', new Set(['a']), none, shared).kind).toBe('sending');
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

	it('marks releases someone already fetched as cached instead of sendable', async () => {
		mockSearch(RESULTS, [
			{ releaseId: 'b', status: 'completed', infoHash: 'h', jobId: 'j' },
			{ releaseId: 'a', status: 'pending', infoHash: null, jobId: 'j2' },
		]);
		render(<UsenetResults imdbId="tt1418646" rdKey="rd-key" />);
		await userEvent.click(screen.getByRole('button', { name: /usenet/i }));
		await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());

		expect(await screen.findByRole('button', { name: /in rd/i })).toBeDisabled();
		expect(screen.getByRole('button', { name: /running/i })).toBeDisabled();
		expect(screen.queryByRole('button', { name: /^send$/i })).not.toBeInTheDocument();
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

		expect(await screen.findByRole('button', { name: /in rd/i })).toBeDisabled();
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

		expect(await screen.findByRole('button', { name: /running/i })).toBeDisabled();
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
