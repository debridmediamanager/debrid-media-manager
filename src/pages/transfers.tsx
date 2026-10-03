import { useRealDebridAccessToken, useTorBoxAccessToken } from '@/hooks/auth';
import {
	addTransferToRd,
	deleteDebridUploaderJob,
	getTrackedDebridUploaderJobs,
	needsRdHandoff,
	runDebridTransferToRd,
} from '@/utils/debridUploader';
import { deleteNzb2rdJob } from '@/utils/nzb2rd';
import { describeTransfer, PHASE_STYLES } from '@/utils/transferPhase';
import {
	isTerminal,
	ORIGIN_LABELS,
	ORIGIN_STYLES,
	originOf,
	TransferRow,
	TransfersResponse,
} from '@/utils/transfers';
import { fetchTransfers } from '@/utils/transfersApi';
import {
	AlertTriangle,
	CheckCircle2,
	ChevronLeft,
	ChevronRight,
	ChevronsLeft,
	Home,
	Loader2,
	RefreshCw,
	RotateCcw,
	Send,
	Trash2,
	XCircle,
} from 'lucide-react';
import Head from 'next/head';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast, Toaster } from 'react-hot-toast';

const POLL_MS = 5000;

/**
 * One page of the list: the cursor it is fetched with, and how many rows the
 * pages before it showed, for the "Showing 101–200" line.
 *
 * The list is paged rather than grown because every refresh files completed
 * transfers into DMM's index and records failed Usenet ones, row by row. A
 * list that grew to an account's 648 transfers would repeat all of that every
 * five seconds; a page keeps it to one page's worth however deep the reader is.
 */
type PageRef = { cursor: string | null; start: number };
const FIRST_PAGE: PageRef = { cursor: null, start: 0 };

const PAGER_BUTTON =
	'haptic-sm inline-flex items-center gap-1 rounded border-2 border-indigo-500 bg-indigo-900/30 px-2 py-1.5 text-xs font-medium text-indigo-100 transition-colors hover:bg-indigo-800/50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-indigo-900/30';

export default function TransfersPage() {
	const [transfers, setTransfers] = useState<TransferRow[]>([]);
	const [degraded, setDegraded] = useState<string[]>([]);
	const [errorText, setErrorText] = useState<string | null>(null);
	const [loaded, setLoaded] = useState(false);
	const [isRefreshing, setIsRefreshing] = useState(false);
	const [rdKey] = useRealDebridAccessToken();
	const tbKey = useTorBoxAccessToken();
	// The pages turned through so far, newest first; the last is the one shown.
	// Kept as a stack so Newer returns to the exact page that was left.
	const [pages, setPages] = useState<PageRef[]>([FIRST_PAGE]);
	const page = pages[pages.length - 1];
	// What the shown page's latest refresh said comes after it. Older always
	// turns to this, never to a cursor saved earlier, so the page turned to
	// starts where the page on screen ends.
	const [next, setNext] = useState<string | null>(null);
	const cursorRef = useRef(page.cursor);
	cursorRef.current = page.cursor;
	const topRef = useRef<HTMLDivElement>(null);
	// failed rows whose retry is being submitted, so a double click sends one job
	const [retrying, setRetrying] = useState<Set<string>>(() => new Set());
	// jobs whose RD handoff is running, so the 5s poll can't start a second one
	const handingOffRef = useRef(new Set<string>());
	const rdKeyRef = useRef(rdKey);
	rdKeyRef.current = rdKey;

	// A transfer this browser joined rather than started belongs to the RD account
	// that created the job, so nothing puts it in *this* user's RD until a client
	// does. The send flow does it when the page that started it is still open;
	// this is the same handoff for everyone who navigated away meanwhile.
	//
	// **The one thing still read from localStorage, and it belongs there.** The
	// list itself is server-owned now, but `adopted`/`rdAdded` record what *this
	// browser* did — whether it created the job, and whether it has already added
	// the result — which is genuinely per-browser state and has no meaning on the
	// account. A job with no local entry is left alone: it was started elsewhere,
	// so its own submitter's RD key is what the service delivered to.
	const handOffToRd = useCallback(async (row: TransferRow) => {
		const key = rdKeyRef.current;
		if (!key || row.source !== 'debrid' || row.status !== 'completed' || !row.info_hash) return;
		if (handingOffRef.current.has(row.id)) return;
		const entry = getTrackedDebridUploaderJobs().find((j) => j.id === row.id);
		if (!entry || !needsRdHandoff(entry)) return;

		handingOffRef.current.add(row.id);
		try {
			if (await addTransferToRd(key, row.info_hash, row.id)) {
				toast.success(
					`${entry.title || row.title || 'Transfer'} added to your Real-Debrid library!`
				);
			}
		} finally {
			handingOffRef.current.delete(row.id);
		}
	}, []);

	const refresh = useCallback(async () => {
		const key = rdKeyRef.current;
		if (!key) return;
		const cursor = cursorRef.current;
		let result: TransfersResponse;
		try {
			result = await fetchTransfers(key, cursor);
		} catch (error) {
			if (cursorRef.current !== cursor) return;
			setErrorText(error instanceof Error ? error.message : 'unreachable');
			setLoaded(true);
			return;
		}
		// A tick sent before the page was turned answers for the page that was
		// left. Showing it would put that page back under the new one's range.
		if (cursorRef.current !== cursor) return;
		setTransfers(result.transfers);
		setDegraded(result.degraded);
		setNext(result.next);
		setErrorText(null);
		setLoaded(true);
		// not awaited: a row's status shouldn't wait on RD
		for (const row of result.transfers) void handOffToRd(row);
	}, [handOffToRd]);

	// One request per tick for the page on screen, rather than one per tracked
	// job. Turning the page changes `page.cursor`, which fetches the new page at
	// once and restarts the timer on it.
	useEffect(() => {
		// `loaded` is what every branch below keys on, so it has to become true
		// even with no key — otherwise a signed-out visitor sits on the spinner
		// forever, since `refresh` (which sets it) returns early.
		if (!rdKey) {
			setLoaded(true);
			return;
		}
		refresh();
		const interval = setInterval(refresh, POLL_MS);
		return () => clearInterval(interval);
	}, [rdKey, refresh, page.cursor]);

	const turnPage = (stack: PageRef[]) => {
		setPages(stack);
		setTransfers([]);
		setNext(null);
		setErrorText(null);
		setLoaded(false);
		topRef.current?.scrollIntoView?.({ block: 'start' });
	};
	const showOlder = () => {
		if (next) turnPage([...pages, { cursor: next, start: page.start + transfers.length }]);
	};
	const showNewer = () => turnPage(pages.slice(0, -1));
	const showNewest = () => turnPage([FIRST_PAGE]);
	const paged = pages.length > 1 || next !== null;

	const pager = (where: 'top' | 'bottom') => (
		<nav
			aria-label={where === 'top' ? 'Transfer pages' : 'Transfer pages, bottom'}
			className={`flex items-center justify-between gap-2 ${where === 'top' ? 'mb-3' : 'mt-3'}`}
		>
			<div className="flex items-center gap-1">
				{pages.length > 2 && (
					<button
						onClick={showNewest}
						disabled={!loaded}
						className={PAGER_BUTTON}
						title="Newest transfers"
						aria-label="Newest transfers"
					>
						<ChevronsLeft className="h-4 w-4" />
					</button>
				)}
				<button
					onClick={showNewer}
					disabled={pages.length < 2 || !loaded}
					className={PAGER_BUTTON}
					title="Newer transfers"
				>
					<ChevronLeft className="h-4 w-4" />
					Newer
				</button>
			</div>
			{loaded && transfers.length > 0 && (
				<span className="text-xs tabular-nums text-gray-400">
					Showing {page.start + 1}–{page.start + transfers.length}
				</span>
			)}
			<button
				onClick={showOlder}
				disabled={!next || !loaded}
				className={PAGER_BUTTON}
				title="Older transfers"
			>
				Older
				<ChevronRight className="h-4 w-4" />
			</button>
		</nav>
	);

	const handleRefreshAll = async () => {
		if (isRefreshing) return;
		setIsRefreshing(true);
		try {
			await refresh();
		} finally {
			setIsRefreshing(false);
		}
	};

	// Deleting is the only way a row leaves the list. There is deliberately no
	// "remove from list": the list is the account's, so a row hidden here would
	// reappear on the next 5s poll.
	//
	// It stays reachable once a row is terminal, which it did not used to be. A
	// failed Usenet job leaves a `nzbrd:` marker behind, and that marker is what
	// makes the release render a disabled "Running" button — for every user, not
	// just this one. `DELETE /api/nzb2rd/jobs/:id` clearing it is the only path
	// there is, so hiding this button on failed rows left the release unsendable
	// by anybody: 2356 of them by the time it was found.
	const handleRemove = async (row: TransferRow, terminal: boolean) => {
		const question = terminal
			? 'Clear this transfer? You will be able to send the release again.'
			: 'Cancel this transfer? The job will be stopped and deleted.';
		if (!window.confirm(question)) return;
		try {
			if (row.source === 'nzb2rd')
				await deleteNzb2rdJob(row.id, row.releaseId, rdKey ?? undefined);
			else await deleteDebridUploaderJob(row.id);
			setTransfers((prev) => prev.filter((t) => t.id !== row.id));
			toast.success(terminal ? 'Transfer cleared.' : 'Transfer cancelled.');
		} catch (error) {
			toast.error(
				`Failed to ${terminal ? 'clear' : 'cancel'}: ${
					error instanceof Error ? error.message : 'unreachable'
				}`
			);
		}
	};

	// A failed TorBox → RD transfer can be sent again from its own row. Before
	// this, the only way back was the title page's TB → RD button, and for a
	// cancelled job that button joined the dead transfer and waited 30 minutes,
	// every time (card 109). It runs the same flow as the library's Send to RD:
	// the same dedup, the same TorBox source, the same toasts.
	const handleRetry = async (row: TransferRow) => {
		if (!rdKey || !tbKey || !row.hash || !row.imdbId || retrying.has(row.id)) return;
		setRetrying((prev) => new Set(prev).add(row.id));
		try {
			await runDebridTransferToRd({
				hash: row.hash,
				imdbId: row.imdbId,
				rdKey,
				tbKey,
				title: row.title || row.name || undefined,
				returnPath: row.returnPath,
			});
		} finally {
			setRetrying((prev) => {
				const next = new Set(prev);
				next.delete(row.id);
				return next;
			});
			void refresh();
		}
	};

	// A failed row is retryable until a newer transfer of the same release shows
	// up in the list, which is what a retry (from here or anywhere) produces.
	// Only this page is known, so a retry listed on a newer page leaves the
	// button up; pressing it joins that transfer rather than starting another,
	// because the send flow joins any transfer of the release already running.
	const canRetry = (row: TransferRow): boolean =>
		row.source === 'debrid' &&
		row.status === 'failed' &&
		!!row.hash &&
		!!row.imdbId &&
		!!tbKey &&
		!transfers.some(
			(other) =>
				other.source === 'debrid' &&
				other.hash === row.hash &&
				other.createdAt > row.createdAt
		);

	return (
		<div className="flex min-h-screen flex-col items-center bg-gray-900 p-4">
			<Head>
				<title>Debrid Media Manager - Transfers</title>
			</Head>
			<Toaster position="bottom-right" />

			<div ref={topRef} className="w-full max-w-3xl">
				<div className="mb-4 flex items-center justify-between">
					<h1 className="flex items-center text-xl font-bold text-white">
						<Send className="mr-2 h-5 w-5 text-indigo-400" />
						Transfers
					</h1>
					<div className="flex items-center gap-2">
						<button
							onClick={handleRefreshAll}
							disabled={isRefreshing || !loaded || !rdKey}
							className={`haptic-sm rounded border-2 border-indigo-500 bg-indigo-900/30 p-2 text-indigo-100 transition-colors hover:bg-indigo-800/50 ${isRefreshing || !loaded || !rdKey ? 'cursor-not-allowed opacity-50' : ''}`}
							title="Refresh all"
						>
							<RefreshCw
								className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`}
							/>
						</button>
						<Link
							href="/"
							className="haptic-sm rounded border-2 border-cyan-500 bg-cyan-900/30 p-2 text-cyan-100 transition-colors hover:bg-cyan-800/50"
							title="Go Home"
						>
							<Home className="h-4 w-4" />
						</Link>
					</div>
				</div>

				<p className="mb-4 text-xs text-gray-400">
					Transfers put content into your Real-Debrid library, sourced from{' '}
					<span className="text-indigo-300">TorBox</span>,{' '}
					<span className="text-sky-300">AllDebrid</span> or{' '}
					<span className="text-amber-300">Usenet</span>. The first tag on each row is
					where its bytes came from — a TorBox/AllDebrid transfer shows{' '}
					<span className="text-slate-300">Cache</span> until the service settles on one.
					Every transfer on your Real-Debrid account is listed here, newest first,
					whichever device started it. Active jobs refresh every {POLL_MS / 1000}s.
				</p>

				{degraded.length > 0 && (
					<div className="mb-3 flex items-start gap-2 rounded border-2 border-yellow-600 bg-yellow-900/20 p-3 text-xs text-yellow-200">
						<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
						<span>
							{degraded.length === 1
								? 'One transfer service is'
								: 'Some transfer services are'}{' '}
							unreachable, so this list may be incomplete. Nothing has been lost —
							those jobs keep running.
						</span>
					</div>
				)}

				{errorText && (
					<div className="mb-3 rounded border-2 border-red-600 bg-red-900/20 p-3 text-xs text-red-200">
						Could not load your transfers: {errorText}
					</div>
				)}

				{rdKey && paged && pager('top')}

				{/*
				 * `loaded` is tested **before** `rdKey`, and the order is load-bearing.
				 * The server cannot read localStorage, so it always renders with no
				 * key; the client's `useLocalStorage` reads it synchronously and has
				 * one on its very first paint. Branching on `rdKey` first therefore
				 * produces different markup on the two sides and React fails
				 * hydration. `loaded` starts false in both, so this branch is
				 * identical everywhere until an effect has run.
				 */}
				{!loaded ? (
					<div className="flex items-center justify-center gap-2 rounded border-2 border-gray-700 bg-gray-800/30 p-6 text-sm text-gray-300">
						<Loader2 className="h-4 w-4 animate-spin" />
						Loading your transfers...
					</div>
				) : !rdKey ? (
					<div className="rounded border-2 border-gray-700 bg-gray-800/30 p-6 text-center text-sm text-gray-300">
						Sign in with Real-Debrid to see your transfers.
					</div>
				) : transfers.length === 0 && pages.length > 1 ? (
					<div className="rounded border-2 border-gray-700 bg-gray-800/30 p-6 text-center text-sm text-gray-300">
						No older transfers.
					</div>
				) : transfers.length === 0 ? (
					<div className="rounded border-2 border-gray-700 bg-gray-800/30 p-6 text-center text-sm text-gray-300">
						No transfers yet. Start one from any TorBox-cached search result with the
						&quot;TB → RD&quot; button, or from the Usenet section on a movie or show
						page.
					</div>
				) : (
					<div className="space-y-2">
						{transfers.map((t) => {
							const progress = describeTransfer(t.source, t);
							const terminal = isTerminal(t.source, t.status);
							const chipStyle = PHASE_STYLES[progress.phase];
							const origin = originOf(t.source, t.jobSource);

							return (
								<div
									key={`${t.source}:${t.id}`}
									className="rounded-lg border-2 border-gray-700 bg-gray-800/30 p-3"
								>
									<div className="flex items-start justify-between gap-2">
										<div className="min-w-0 flex-1">
											<h2 className="truncate text-sm font-bold text-white">
												{t.title || t.name || t.id}
											</h2>
											<div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-400">
												<span
													className={`inline-flex items-center rounded border-2 px-1.5 py-0.5 font-medium ${ORIGIN_STYLES[origin]}`}
													title={
														origin === 'cache'
															? 'Waiting on the service to pick TorBox or AllDebrid'
															: `Sourced from ${ORIGIN_LABELS[origin]}`
													}
												>
													{ORIGIN_LABELS[origin]}
												</span>
												<span
													className={`inline-flex items-center rounded border-2 px-1.5 py-0.5 font-medium ${chipStyle}`}
												>
													{progress.phase === 'completed' && (
														<CheckCircle2 className="mr-1 h-3 w-3" />
													)}
													{progress.phase === 'failed' && (
														<XCircle className="mr-1 h-3 w-3" />
													)}
													{!terminal && (
														<Loader2 className="mr-1 h-3 w-3 animate-spin" />
													)}
													{progress.label}
												</span>
												{t.returnPath && (
													<Link
														href={t.returnPath}
														className="text-indigo-300 underline hover:text-indigo-200"
													>
														{t.imdbId}
													</Link>
												)}
												<span>
													{new Date(t.createdAt).toLocaleString()}
												</span>
											</div>
											{progress.percent !== null && (
												<div className="mt-2">
													<div className="mb-1 flex items-center justify-between text-[11px] text-gray-400">
														<span>
															{progress.step !== null
																? `Step ${progress.step} of ${progress.totalSteps} — ${progress.label}`
																: progress.label}
															{progress.detail && (
																<span className="text-indigo-300">
																	{' · '}
																	{progress.detail}
																</span>
															)}
														</span>
														<span className="tabular-nums">
															{progress.percent}%
														</span>
													</div>
													<div
														className="h-1.5 w-full overflow-hidden rounded bg-gray-700"
														role="progressbar"
														aria-valuenow={progress.percent}
														aria-valuemin={0}
														aria-valuemax={100}
														aria-label={progress.label}
													>
														<div
															className={`h-full rounded transition-all duration-500 ${
																progress.phase === 'completed'
																	? 'bg-green-500'
																	: 'bg-indigo-500'
															}`}
															style={{
																width: `${progress.percent}%`,
															}}
														/>
													</div>
												</div>
											)}
											{t.status_message && !terminal && (
												<div className="mt-1 text-xs text-gray-300">
													{t.status_message}
												</div>
											)}
											{t.status === 'failed' && t.error && (
												<div className="mt-1 break-words text-xs text-red-300">
													{t.error}
												</div>
											)}
										</div>
										<div className="flex shrink-0 items-center gap-1">
											{canRetry(t) && (
												<button
													onClick={() => handleRetry(t)}
													disabled={retrying.has(t.id)}
													className={`haptic-sm rounded border-2 border-indigo-500 bg-indigo-900/30 p-1.5 text-indigo-100 transition-colors hover:bg-indigo-800/50 ${retrying.has(t.id) ? 'cursor-not-allowed opacity-50' : ''}`}
													title="Retry transfer"
													aria-label="Retry transfer"
												>
													{retrying.has(t.id) ? (
														<Loader2 className="h-4 w-4 animate-spin" />
													) : (
														<RotateCcw className="h-4 w-4" />
													)}
												</button>
											)}
											<button
												onClick={() => handleRemove(t, terminal)}
												className="haptic-sm rounded border-2 border-red-500 bg-red-900/30 p-1.5 text-red-100 transition-colors hover:bg-red-800/50"
												title={
													terminal ? 'Clear transfer' : 'Cancel transfer'
												}
											>
												{terminal ? (
													<Trash2 className="h-4 w-4" />
												) : (
													<XCircle className="h-4 w-4" />
												)}
											</button>
										</div>
									</div>
								</div>
							);
						})}
					</div>
				)}

				{rdKey && paged && loaded && transfers.length > 0 && pager('bottom')}
			</div>
		</div>
	);
}
