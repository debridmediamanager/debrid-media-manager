import { useAllDebridApiKey, useRealDebridAccessToken, useTorBoxAccessToken } from '@/hooks/auth';
import type { PublicRequest } from '@/utils/contentRequest';
import {
	cancelContentRequest,
	fetchContentRequests,
	fulfillContentRequest,
} from '@/utils/contentRequestsApi';
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
 * The request board.
 *
 * The uploader needs two credentials to move a release — a Real-Debrid key for
 * where it lands and a TorBox or AllDebrid key for where the bytes come from.
 * A user with only Real-Debrid holds one of them, so this page is where they
 * leave their half and where somebody holding the other half picks it up.
 *
 * It polls, unlike the pages that only read their own state: a row's status is
 * moved by *other people*, so a board that never refreshed would keep offering
 * a request somebody claimed a minute ago.
 */

const POLL_MS = 15000;

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

export default function RequestsPage() {
	const [requests, setRequests] = useState<PublicRequest[]>([]);
	const [errorText, setErrorText] = useState<string | null>(null);
	const [loaded, setLoaded] = useState(false);
	const [isRefreshing, setIsRefreshing] = useState(false);
	const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
	const [rdKey] = useRealDebridAccessToken();
	const torboxKey = useTorBoxAccessToken();
	const adKey = useAllDebridApiKey();

	const rdKeyRef = useRef(rdKey);
	rdKeyRef.current = rdKey;

	const canFulfil = Boolean(rdKey) && Boolean(torboxKey || adKey);

	const refresh = useCallback(async () => {
		try {
			const { requests: rows } = await fetchContentRequests(rdKeyRef.current);
			setRequests(rows);
			setErrorText(null);
		} catch (error) {
			setErrorText(error instanceof Error ? error.message : 'unreachable');
		} finally {
			setLoaded(true);
		}
	}, []);

	// The board is readable signed out, so this runs with or without a key —
	// unlike Transfers, which has nothing to show without one.
	useEffect(() => {
		refresh();
		const interval = setInterval(refresh, POLL_MS);
		return () => clearInterval(interval);
	}, [rdKey, refresh]);

	const handleRefresh = async () => {
		if (isRefreshing) return;
		setIsRefreshing(true);
		try {
			await refresh();
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
				await fulfillContentRequest(key, row.id, { tbKey: torboxKey, adKey });
				toast.success('Transfer started. Thank you!');
				await refresh();
			} catch (error) {
				toast.error(
					`Could not fulfil: ${error instanceof Error ? error.message : 'unreachable'}`
				);
				// Somebody else may have taken it a second ago, so the board is
				// re-read rather than left showing a row that is no longer there.
				await refresh();
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
				await refresh();
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
					Getting a release into Real-Debrid takes two accounts: a{' '}
					<span className="text-emerald-300">Real-Debrid</span> one for where it lands,
					and a <span className="text-indigo-300">TorBox</span> or{' '}
					<span className="text-sky-300">AllDebrid</span> one for where the bytes come
					from. If you only have Real-Debrid, ask here from any search result and someone
					with the other half can send it to you. Fulfilling spends your own quota and the
					release lands in the asker&apos;s library, not yours. Refreshes every{' '}
					{POLL_MS / 1000}s.
				</p>

				{errorText && (
					<div className="mb-3 rounded border-2 border-red-600 bg-red-900/20 p-3 text-xs text-red-200">
						Could not load the board: {errorText}
					</div>
				)}

				{loaded && !canFulfil && rdKey && (
					<div className="mb-3 rounded border-2 border-gray-700 bg-gray-800/30 p-3 text-xs text-gray-300">
						Add a TorBox or AllDebrid key in settings to fulfil requests for others.
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
						Nothing requested right now. Ask for something with the{' '}
						<span className="text-cyan-300">Request</span> button on any search result
						your Real-Debrid account cannot reach.
					</div>
				) : (
					<div className="space-y-2">
						{requests.map((row) => {
							const busy = busyIds.has(row.id);
							const claimable = CLAIMABLE.has(row.status);
							const style = STATUS_STYLES[row.status] ?? STATUS_STYLES.cancelled;
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
				)}
			</div>
		</div>
	);
}
