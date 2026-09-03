import { useAllDebridApiKey, useRealDebridAccessToken, useTorBoxAccessToken } from '@/hooks/auth';
import type { SearchResult } from '@/services/mediasearch';
import type { PublicRequest } from '@/utils/contentRequest';
import {
	cancelContentRequest,
	fetchContentRequests,
	fulfillContentRequest,
} from '@/utils/contentRequestsApi';
import { checkDatabaseAvailabilityAd, checkDatabaseAvailabilityTb } from '@/utils/instantChecks';
import { generateTokenAndHash } from '@/utils/token';
import {
	CheckCircle2,
	HandHeart,
	Home,
	Loader2,
	RefreshCw,
	Send,
	Trash2,
	XCircle,
} from 'lucide-react';
import Head from 'next/head';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast, Toaster } from 'react-hot-toast';

/**
 * The request board — the fulfillers' view.
 *
 * A Real-Debrid user files an ask from a search result. Here a TorBox or
 * AllDebrid user picks one up: fulfilling fetches the release with *their* quota
 * and lands it in the asker's Real-Debrid library. So the page runs a cache
 * check across everything on it with the viewer's own keys, which is the thing
 * that tells a fulfiller what they can actually serve, and asks before spending
 * anything.
 *
 * It pages the board 25 at a time and loads the next page as the last one
 * scrolls into view, because the board grows without bound and nobody scrolls
 * three thousand rows.
 *
 * **Premiumize, Offcloud and Debrid-Link are deliberately absent**, from the
 * fulfil path and from the cache checks alike: the uploader can source a
 * transfer from TorBox and AllDebrid only, so those three keys buy a viewer
 * nothing here. None of them is offered the board on the home page either
 * (`MainActions`), which is why probing for them would be spending a request to
 * render a badge nobody with only those keys ever sees.
 *
 * Debrid-Link is doubly excluded: it has no cache probe at all, so the only way
 * to answer "can I serve this" would be to *add* the torrent — spending one of
 * the account's 50 adds a day per row of a board that pages 25 at a time.
 */

const PAGE_SIZE = 25;

const STATUS_STYLES: Record<string, string> = {
	open: 'border-cyan-500 bg-cyan-900/30 text-cyan-100',
	failed: 'border-amber-500 bg-amber-900/30 text-amber-100',
	claimed: 'border-violet-500 bg-violet-900/30 text-violet-100',
	fulfilled: 'border-green-500 bg-green-900/30 text-green-100',
	cancelled: 'border-gray-500 bg-gray-900/30 text-gray-400',
};

const STATUS_LABELS: Record<string, string> = {
	open: 'Open',
	// Not "Failed": the row is back on the board and can be taken again, so the
	// word has to describe the request rather than the attempt that missed.
	failed: 'Open — last try failed',
	claimed: 'Being fulfilled',
	fulfilled: 'Sent',
	cancelled: 'Withdrawn',
};

/** Only these can be taken, matching `isClaimable` on the server. */
const CLAIMABLE = new Set(['open', 'failed']);

/**
 * A stand-in torrent for one request, only so the cache-check helpers — which
 * all speak `SearchResult` — can write their answers onto it. Nothing here is
 * rendered; the row reads back `tbAvailable`/`adAvailable` alone.
 */
function seedResult(row: PublicRequest): SearchResult {
	return {
		hash: row.hash,
		title: row.title || row.hash,
		fileSize: 0,
		rdAvailable: false,
		adAvailable: false,
		tbAvailable: false,
		pmAvailable: false,
		ocAvailable: false,
		files: [],
		noVideos: false,
		medianFileSize: 0,
		biggestFileSize: 0,
		videoCount: 0,
		imdbId: row.imdbId,
	};
}

const identity = <T,>(x: T): T => x;

export default function RequestsPage() {
	const [requests, setRequests] = useState<PublicRequest[]>([]);
	// Availability answers, one entry per request seen, keyed by hash.
	const [checkResults, setCheckResults] = useState<SearchResult[]>([]);
	const [errorText, setErrorText] = useState<string | null>(null);
	const [loaded, setLoaded] = useState(false);
	const [isRefreshing, setIsRefreshing] = useState(false);
	const [loadingMore, setLoadingMore] = useState(false);
	const [hasMore, setHasMore] = useState(false);
	const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

	const [rdKey] = useRealDebridAccessToken();
	const torboxKey = useTorBoxAccessToken();
	const adKey = useAllDebridApiKey();

	const rdKeyRef = useRef(rdKey);
	rdKeyRef.current = rdKey;
	// How many rows are loaded, so the next page starts after them without a
	// stale closure snapshotting the count.
	const offsetRef = useRef(0);
	// A single in-flight guard shared by the scroll trigger and the buttons.
	const loadingRef = useRef(false);

	// TorBox is the only source the uploader can pull from, so it is the only key
	// the board cares about. AllDebrid was withdrawn on 2026-09-01 with debrid01,
	// the one uploader host whose IP it permitted; offering fulfil to an AD-only
	// holder would now only earn them a 400. (Premiumize is not one either: the
	// uploader cannot source from it, which is why a Premiumize user is not sent
	// here in the first place.)
	const canFulfil = Boolean(rdKey) && Boolean(torboxKey);
	const hasFulfillerKey = Boolean(torboxKey);

	/**
	 * Ask each service the viewer holds a key for which of these hashes it has
	 * cached, and let the answers land on `checkResults`. Fire-and-forget: a row
	 * simply gains its badge whenever its service replies, and a service that is
	 * slow or down never blocks the others or the page.
	 */
	const runChecks = useCallback(
		async (rows: PublicRequest[]) => {
			if (rows.length === 0) return;
			setCheckResults((prev) => {
				const known = new Set(prev.map((p) => p.hash));
				const add = rows.filter((r) => !known.has(r.hash)).map(seedResult);
				return add.length ? [...prev, ...add] : prev;
			});

			const hashes = rows.map((r) => r.hash);
			if (torboxKey) {
				checkDatabaseAvailabilityTb(torboxKey, hashes, setCheckResults, identity).catch(
					() => {}
				);
			}
			if (adKey) {
				// AllDebrid availability is read from DMM's own store, which is keyed
				// per title, so the hashes are grouped by imdbId. One token covers the
				// whole batch.
				try {
					const [token, solution] = await generateTokenAndHash();
					const byImdb = new Map<string, string[]>();
					for (const r of rows) {
						const list = byImdb.get(r.imdbId) ?? [];
						list.push(r.hash);
						byImdb.set(r.imdbId, list);
					}
					for (const [imdbId, hs] of byImdb) {
						checkDatabaseAvailabilityAd(
							token,
							solution,
							imdbId,
							hs,
							setCheckResults,
							identity
						).catch(() => {});
					}
				} catch {
					// a failed token fetch just means no AD badges this pass
				}
			}
		},
		[torboxKey, adKey]
	);

	/**
	 * Load one page. `reset` starts the board over from the top — used by the
	 * refresh button and whenever the identity changes — while the scroll trigger
	 * calls it to append the next page.
	 */
	const loadPage = useCallback(
		async (reset: boolean) => {
			if (loadingRef.current) return;
			loadingRef.current = true;
			if (!reset) setLoadingMore(true);
			const offset = reset ? 0 : offsetRef.current;
			try {
				const { requests: rows, hasMore: more } = await fetchContentRequests(
					rdKeyRef.current,
					{ offset, limit: PAGE_SIZE }
				);
				offsetRef.current = offset + rows.length;
				setHasMore(more);
				setErrorText(null);
				if (reset) {
					setRequests(rows);
					setCheckResults([]);
				} else {
					setRequests((prev) => {
						const seen = new Set(prev.map((r) => r.id));
						return [...prev, ...rows.filter((r) => !seen.has(r.id))];
					});
				}
				void runChecks(rows);
			} catch (error) {
				setErrorText(error instanceof Error ? error.message : 'unreachable');
			} finally {
				setLoaded(true);
				setLoadingMore(false);
				loadingRef.current = false;
			}
		},
		[runChecks]
	);

	// Reload from the top whenever the RD identity changes (sign-in/out). The
	// board itself is readable signed out, so this runs with or without a key.
	useEffect(() => {
		loadPage(true);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [rdKey]);

	// Infinite scroll: when the sentinel at the end of the list comes into view
	// and there is another page, fetch it.
	const sentinelRef = useRef<HTMLDivElement | null>(null);
	useEffect(() => {
		const el = sentinelRef.current;
		if (!el || !hasMore) return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries[0]?.isIntersecting && hasMore && !loadingRef.current) {
					loadPage(false);
				}
			},
			{ rootMargin: '400px' }
		);
		observer.observe(el);
		return () => observer.disconnect();
	}, [hasMore, loadPage]);

	const handleRefresh = async () => {
		if (isRefreshing) return;
		setIsRefreshing(true);
		try {
			await loadPage(true);
		} finally {
			setIsRefreshing(false);
		}
	};

	const withBusy = async (id: string, work: () => Promise<void>) => {
		if (busyIds.has(id)) return;
		setBusyIds((prev) => new Set(prev).add(id));
		try {
			await work();
		} finally {
			setBusyIds((prev) => {
				const next = new Set(prev);
				next.delete(id);
				return next;
			});
		}
	};

	const availabilityOf = (hash: string): SearchResult | undefined =>
		checkResults.find((c) => c.hash === hash);

	/**
	 * Take a request and pay for it.
	 *
	 * Confirmed rather than immediate because the cost lands on the person
	 * clicking: the transfer spends *their* TorBox or AllDebrid quota, and what
	 * it produces goes into somebody else's Real-Debrid library. Nothing about
	 * it comes back to them.
	 */
	const handleFulfil = (row: PublicRequest) =>
		withBusy(row.id, async () => {
			const key = rdKeyRef.current;
			if (!key) return;
			const source = torboxKey ? 'TorBox' : 'AllDebrid';
			if (
				!window.confirm(
					`Fulfil this request using your ${source} account?\n\n` +
						`${row.title || row.hash}\n\n` +
						`The release is fetched with your ${source} quota and lands in the ` +
						`asker's Real-Debrid library, not yours.`
				)
			)
				return;
			try {
				const jobId = await fulfillContentRequest(key, row.id, { tbKey: torboxKey });
				toast.success('Transfer started. Thank you!');
				// Reflect it in place rather than reloading, so the scroll position
				// and the rest of the loaded pages survive.
				setRequests((prev) =>
					prev.map((r) => (r.id === row.id ? { ...r, status: 'fulfilled', jobId } : r))
				);
			} catch (error) {
				toast.error(
					`Could not fulfil: ${error instanceof Error ? error.message : 'unreachable'}`
				);
				// Somebody else may have taken it a second ago, so start the board
				// over rather than leave a row that is no longer takeable.
				await loadPage(true);
			}
		});

	const handleCancel = (row: PublicRequest) =>
		withBusy(row.id, async () => {
			const key = rdKeyRef.current;
			if (!key) return;
			if (!window.confirm('Withdraw this request?')) return;
			try {
				await cancelContentRequest(key, row.id);
				setRequests((prev) => prev.filter((r) => r.id !== row.id));
				toast.success('Request withdrawn.');
			} catch (error) {
				toast.error(
					`Could not withdraw: ${error instanceof Error ? error.message : 'unreachable'}`
				);
				await loadPage(true);
			}
		});

	return (
		<div className="flex min-h-screen flex-col items-center bg-gray-900 p-4">
			<Head>
				<title>Debrid Media Manager - Requests</title>
			</Head>
			<Toaster position="bottom-right" />

			<div className="w-full max-w-3xl">
				<div className="mb-4 flex items-center justify-between">
					<h1 className="flex items-center text-xl font-bold text-white">
						<HandHeart className="mr-2 h-5 w-5 text-cyan-400" />
						Requests
					</h1>
					<div className="flex items-center gap-2">
						<button
							onClick={handleRefresh}
							disabled={isRefreshing || !loaded}
							className={`haptic-sm rounded border-2 border-indigo-500 bg-indigo-900/30 p-2 text-indigo-100 transition-colors hover:bg-indigo-800/50 ${isRefreshing || !loaded ? 'cursor-not-allowed opacity-50' : ''}`}
							title="Refresh"
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
					These are releases people want in their{' '}
					<span className="text-emerald-300">Real-Debrid</span> library but cannot fetch
					themselves. Fulfil one with your <span className="text-indigo-300">TorBox</span>{' '}
					or <span className="text-sky-300">AllDebrid</span> account and it lands in the
					asker&apos;s library, not yours, on your quota. Every row is checked against the
					accounts you hold, so a <span className="text-cyan-300">cached</span> badge
					means you can serve it instantly.
				</p>

				{errorText && (
					<div className="mb-3 rounded border-2 border-red-600 bg-red-900/20 p-3 text-xs text-red-200">
						Could not load the board: {errorText}
					</div>
				)}

				{loaded && !canFulfil && hasFulfillerKey && (
					<div className="mb-3 rounded border-2 border-gray-700 bg-gray-800/30 p-3 text-xs text-gray-300">
						Sign in with Real-Debrid to fulfil requests for others.
					</div>
				)}

				{/*
				 * `loaded` is tested before anything key-dependent, and the order is
				 * load-bearing: the server renders with no key, the client reads one
				 * from localStorage on its first paint, and branching on the key first
				 * makes the two disagree and fails hydration.
				 */}
				{!loaded ? (
					<div className="flex items-center justify-center gap-2 rounded border-2 border-gray-700 bg-gray-800/30 p-6 text-sm text-gray-300">
						<Loader2 className="h-4 w-4 animate-spin" />
						Loading the board...
					</div>
				) : requests.length === 0 ? (
					<div className="rounded border-2 border-gray-700 bg-gray-800/30 p-6 text-center text-sm text-gray-300">
						Nothing requested right now. Real-Debrid users leave asks here with the{' '}
						<span className="text-cyan-300">Request</span> button on a search result
						they cannot fetch themselves.
					</div>
				) : (
					<>
						<div className="space-y-2">
							{requests.map((row) => {
								const busy = busyIds.has(row.id);
								const claimable = CLAIMABLE.has(row.status);
								const style = STATUS_STYLES[row.status] ?? STATUS_STYLES.cancelled;
								const avail = availabilityOf(row.hash);
								const href =
									row.mediaType === 'show'
										? `/show/${row.imdbId}`
										: `/movie/${row.imdbId}`;

								return (
									<div
										key={row.id}
										className="rounded-lg border-2 border-gray-700 bg-gray-800/30 p-3"
									>
										<div className="flex items-start justify-between gap-2">
											<div className="min-w-0 flex-1">
												<h2 className="truncate text-sm font-bold text-white">
													{row.title || row.hash}
												</h2>
												<div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-400">
													<span
														className={`inline-flex items-center rounded border-2 px-1.5 py-0.5 font-medium ${style}`}
													>
														{row.status === 'fulfilled' && (
															<CheckCircle2 className="mr-1 h-3 w-3" />
														)}
														{row.status === 'claimed' && (
															<Loader2 className="mr-1 h-3 w-3 animate-spin" />
														)}
														{STATUS_LABELS[row.status] ?? row.status}
													</span>
													{avail?.tbAvailable && (
														<span className="inline-flex items-center rounded border-2 border-indigo-500 bg-indigo-900/30 px-1.5 py-0.5 font-medium text-indigo-100">
															TB cached
														</span>
													)}
													{avail?.adAvailable && (
														<span className="inline-flex items-center rounded border-2 border-sky-500 bg-sky-900/30 px-1.5 py-0.5 font-medium text-sky-100">
															AD cached
														</span>
													)}
													{row.mine && (
														<span className="inline-flex items-center rounded border-2 border-emerald-500 bg-emerald-900/30 px-1.5 py-0.5 font-medium text-emerald-100">
															Yours
														</span>
													)}
													<Link
														href={href}
														className="text-indigo-300 underline hover:text-indigo-200"
													>
														{row.imdbId}
													</Link>
													<span>
														{new Date(row.createdAt).toLocaleString()}
													</span>
												</div>
												{row.mine && row.jobId && (
													<div className="mt-1 text-xs text-gray-300">
														Somebody sent this.{' '}
														<Link
															href="/transfers"
															className="text-indigo-300 underline hover:text-indigo-200"
														>
															Follow it on Transfers
														</Link>
														.
													</div>
												)}
											</div>
											<div className="flex shrink-0 items-center gap-1">
												{canFulfil && claimable && !row.mine && (
													<button
														onClick={() => handleFulfil(row)}
														disabled={busy}
														className={`haptic-sm inline-flex items-center rounded border-2 border-indigo-500 bg-indigo-900/30 px-2 py-1.5 text-xs text-indigo-100 transition-colors hover:bg-indigo-800/50 ${busy ? 'cursor-not-allowed opacity-50' : ''}`}
														title="Send this to the asker using your TorBox or AllDebrid account"
													>
														{busy ? (
															<Loader2 className="mr-1 h-3 w-3 animate-spin" />
														) : (
															<Send className="mr-1 h-3 w-3" />
														)}
														Fulfil
													</button>
												)}
												{row.mine && claimable && (
													<button
														onClick={() => handleCancel(row)}
														disabled={busy}
														className={`haptic-sm rounded border-2 border-red-500 bg-red-900/30 p-1.5 text-red-100 transition-colors hover:bg-red-800/50 ${busy ? 'cursor-not-allowed opacity-50' : ''}`}
														title="Withdraw this request"
													>
														{busy ? (
															<Loader2 className="h-4 w-4 animate-spin" />
														) : (
															<Trash2 className="h-4 w-4" />
														)}
													</button>
												)}
												{row.status === 'cancelled' && (
													<XCircle className="h-4 w-4 text-gray-500" />
												)}
											</div>
										</div>
									</div>
								);
							})}
						</div>

						{/* The scroll sentinel. Kept in the tree whenever another page
						    exists so the observer has something to watch. */}
						{hasMore && (
							<div
								ref={sentinelRef}
								className="flex items-center justify-center gap-2 py-4 text-xs text-gray-400"
							>
								{loadingMore && <Loader2 className="h-4 w-4 animate-spin" />}
								{loadingMore ? 'Loading more...' : 'Scroll for more'}
							</div>
						)}
					</>
				)}
			</div>
		</div>
	);
}
