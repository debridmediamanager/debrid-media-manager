import { UsenetResult } from '@/services/nzb2rd';
import { transferContextFromPath } from '@/utils/debridUploader';
import {
	createNzb2rdJob,
	fetchNzb2rdTransfers,
	followNzb2rdTransfer,
	isNzb2rdDuplicate,
	trackNzb2rdJob,
} from '@/utils/nzb2rd';
import { readRdOAuthCredentials } from '@/utils/rdTokenStorage';
import { TRANSFER_LABELS, TRANSFER_STEP_TOAST_MS, TRANSFER_TOAST_MS } from '@/utils/transferPhase';
import { Check, ChevronDown, ChevronRight, Loader2, Send } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import toast from 'react-hot-toast';

type SortKey = 'title' | 'size';
type SortDir = 'asc' | 'desc';

type UsenetResultsProps = {
	imdbId: string;
	/** Present for a show season, absent for a movie. */
	seasonNum?: number;
	/** Show title, so whole-season packs can be looked up by name. */
	title?: string;
	rdKey: string | null;
};

/** Bytes → GB, matching how sizes read elsewhere on these pages. */
export function formatSize(bytes: number): string {
	if (!bytes) return '—';
	return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function sortResults(results: UsenetResult[], key: SortKey, dir: SortDir): UsenetResult[] {
	const factor = dir === 'asc' ? 1 : -1;
	return [...results].sort((a, b) => {
		if (key === 'size') return (a.size - b.size) * factor;
		return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }) * factor;
	});
}

export type SendButtonKind = 'send' | 'sending' | 'sent' | 'cached' | 'running';

/**
 * What the row's button says. A release someone has already fetched shows as
 * cached rather than sendable, because a Usenet fetch costs indexer grab quota
 * and block-account bytes and the server would dedup it anyway.
 */
export function buttonState(
	id: string,
	sending: Set<string>,
	sent: Set<string>,
	transferred: Map<string, 'pending' | 'completed'>
): { kind: SendButtonKind; label: string; title: string; disabled: boolean } {
	if (sending.has(id)) {
		return { kind: 'sending', label: 'Sending', title: 'Submitting…', disabled: true };
	}
	if (sent.has(id)) {
		return {
			kind: 'sent',
			label: 'Sent',
			title: 'Sent — follow it on the Transfers page',
			disabled: true,
		};
	}
	const existing = transferred.get(id);
	if (existing === 'completed') {
		return {
			kind: 'cached',
			label: 'In RD',
			title: 'Already fetched — available as a cached result for this title',
			disabled: true,
		};
	}
	if (existing === 'pending') {
		return {
			kind: 'running',
			label: 'Running',
			title: 'Someone is already fetching this release',
			disabled: true,
		};
	}
	return {
		kind: 'send',
		label: 'Send',
		title: 'Send to Real-Debrid via nzb2rd',
		disabled: false,
	};
}

// Usenet is a second supply line next to the torrent results above: nothing here
// is cached anywhere, so there is no availability to check and no reason to load
// it for every visitor. The section stays collapsed until asked for, and fetches
// once — the indexer bills a daily API-call quota.
const UsenetResults = ({ imdbId, seasonNum, title, rdKey }: UsenetResultsProps) => {
	const [isOpen, setIsOpen] = useState(false);
	const [results, setResults] = useState<UsenetResult[] | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [sortKey, setSortKey] = useState<SortKey>('size');
	const [sortDir, setSortDir] = useState<SortDir>('desc');
	const [sendingIds, setSendingIds] = useState<Set<string>>(new Set());
	const [sentIds, setSentIds] = useState<Set<string>>(new Set());
	// Releases someone has already fetched, so the row shows its state instead of
	// a Send that the server would only reject as a duplicate.
	const [transferred, setTransferred] = useState<Map<string, 'pending' | 'completed'>>(new Map());

	const fetchResults = useCallback(async () => {
		setIsLoading(true);
		setError(null);
		try {
			const params = new URLSearchParams({ imdbId });
			if (seasonNum !== undefined) params.set('seasonNum', String(seasonNum));
			if (seasonNum !== undefined && title) params.set('title', title);
			const response = await fetch(`/api/nzb2rd/search?${params}`);
			const data = await response.json().catch(() => null);
			if (!response.ok) throw new Error(data?.error || `Search failed (${response.status})`);
			const found: UsenetResult[] = Array.isArray(data?.results) ? data.results : [];
			setResults(found);

			// Best-effort, and deliberately not awaited into the error path: a
			// failed lookup should never hide the results themselves.
			fetchNzb2rdTransfers(found.map((r) => r.id)).then((existing) =>
				setTransferred(new Map(existing.map((t) => [t.releaseId, t.status])))
			);
		} catch (e) {
			setError(e instanceof Error ? e.message : 'Usenet search failed');
			setResults(null);
		} finally {
			setIsLoading(false);
		}
	}, [imdbId, seasonNum, title]);

	const toggle = () => {
		const opening = !isOpen;
		setIsOpen(opening);
		if (opening && results === null && !isLoading) fetchResults();
	};

	const changeSort = (key: SortKey) => {
		if (key === sortKey) {
			setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
			return;
		}
		setSortKey(key);
		// Biggest-first and A-Z are the useful defaults for their columns.
		setSortDir(key === 'size' ? 'desc' : 'asc');
	};

	const sorted = useMemo(
		() => (results ? sortResults(results, sortKey, sortDir) : []),
		[results, sortKey, sortDir]
	);

	const returnPath = () =>
		seasonNum !== undefined ? `/show/${imdbId}/${seasonNum}` : `/movie/${imdbId}`;

	const label = TRANSFER_LABELS.usenet;

	const send = async (result: UsenetResult) => {
		if (!rdKey) {
			toast.error('Log in with Real-Debrid to send Usenet releases', { duration: 5000 });
			return;
		}
		if (sendingIds.has(result.id) || sentIds.has(result.id)) return;

		setSendingIds((prev) => new Set(prev).add(result.id));
		// One toast per transfer, carried from submit to the point RD takes over,
		// exactly as a TorBox or AllDebrid send does. `followNzb2rdTransfer` runs
		// detached: the row is "Sent" the moment the job exists, and the Usenet
		// pass that follows is minutes long.
		const toastId = toast.loading(`${label}: submitting transfer...`, {
			duration: TRANSFER_STEP_TOAST_MS,
		});
		const follow = (jobId: string) =>
			void followNzb2rdTransfer({
				jobId,
				toastId,
				context: transferContextFromPath(returnPath()),
				releaseId: result.id,
			});
		try {
			const job = await createNzb2rdJob({
				id: result.id,
				title: result.title,
				imdbId,
				rdKey,
				// The access token above dies 24h after login and this fetch can sit
				// in nzb2rd's queue for days; these do not expire, so the service can
				// mint a live token when it actually reaches Real-Debrid.
				oauth: readRdOAuthCredentials(),
				returnPath: returnPath(),
			});

			if (isNzb2rdDuplicate(job)) {
				setTransferred((prev) =>
					new Map(prev).set(
						result.id,
						job.duplicate === 'completed' ? 'completed' : 'pending'
					)
				);

				if (job.duplicate === 'completed') {
					toast.success(
						job.added
							? `${label}: already fetched — it is in your Real-Debrid library.`
							: `${label}: already fetched, but adding it to your library failed. Try the cached result above.`,
						{ id: toastId, duration: TRANSFER_TOAST_MS }
					);
					return;
				}

				// Someone else is already fetching this. Follow their job rather than
				// starting a second one: nzb2rd queues this account's key against it
				// too, so the same toast can see it through to RD.
				trackNzb2rdJob({
					id: job.jobId,
					releaseId: result.id,
					imdbId,
					title: result.title,
					returnPath: returnPath(),
					createdAt: Date.now(),
				});
				toast.loading(
					`${label}: already being fetched for someone else — you get it too.`,
					{
						id: toastId,
						duration: TRANSFER_STEP_TOAST_MS,
					}
				);
				follow(job.jobId);
				return;
			}

			// Remembered by this browser so the Transfers page can follow it; the
			// job itself keeps running server-side either way.
			trackNzb2rdJob({
				id: job.id,
				releaseId: result.id,
				imdbId,
				title: result.title,
				returnPath: returnPath(),
				createdAt: Date.now(),
			});
			setSentIds((prev) => new Set(prev).add(result.id));
			toast.loading(`${label}: transfer started — track it on the Transfers page.`, {
				id: toastId,
				duration: TRANSFER_STEP_TOAST_MS,
			});
			follow(job.id);
		} catch (e) {
			toast.error(`${label}: ${e instanceof Error ? e.message : 'send failed'}`, {
				id: toastId,
				duration: TRANSFER_TOAST_MS,
			});
		} finally {
			setSendingIds((prev) => {
				const next = new Set(prev);
				next.delete(result.id);
				return next;
			});
		}
	};

	const sortArrow = (key: SortKey) => (sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '');

	// Both pages read the id straight off router.query, which is undefined on the
	// first client render. Showing the toggle then would let a fast click search
	// for "undefined" and come back 400.
	if (!imdbId) return null;

	return (
		<div className="mx-2 my-4 rounded border border-gray-700 bg-gray-800/30">
			<button
				type="button"
				onClick={toggle}
				aria-expanded={isOpen}
				className="haptic flex w-full items-center gap-2 px-4 py-3 text-left font-medium text-gray-100 transition-colors duration-200 hover:bg-gray-700/50"
			>
				{isOpen ? (
					<ChevronDown className="h-4 w-4 shrink-0" />
				) : (
					<ChevronRight className="h-4 w-4 shrink-0" />
				)}
				{/* The hyphen is a break opportunity, so a narrow screen would otherwise
				    split the service name across two lines as "Real-" / "Debrid". */}
				<span>
					Send NZBs from Usenet to <span className="whitespace-nowrap">Real-Debrid</span>
				</span>
				{results !== null && (
					<span className="text-sm text-gray-400">({results.length})</span>
				)}
				{isLoading && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
			</button>

			{isOpen && (
				<div className="border-t border-gray-700 px-2 pb-2">
					{isLoading && (
						<p className="px-2 py-3 text-sm text-gray-400">Searching Usenet…</p>
					)}

					{error && (
						<div className="flex items-center gap-3 px-2 py-3 text-sm text-red-300">
							<span>{error}</span>
							<button
								type="button"
								onClick={fetchResults}
								className="haptic rounded border border-gray-500 px-2 py-1 text-gray-100 hover:bg-gray-700/50"
							>
								Retry
							</button>
						</div>
					)}

					{!isLoading && !error && results !== null && results.length === 0 && (
						<p className="px-2 py-3 text-sm text-gray-400">No Usenet results found.</p>
					)}

					{!isLoading && !error && sorted.length > 0 && (
						<div className="overflow-x-auto">
							<table className="w-full table-auto text-sm">
								<thead>
									<tr className="text-left text-gray-400">
										<th className="px-2 py-2">
											<button
												type="button"
												onClick={() => changeSort('title')}
												className="font-medium hover:text-gray-100"
											>
												Release{sortArrow('title')}
											</button>
										</th>
										<th className="w-28 px-2 py-2">
											<button
												type="button"
												onClick={() => changeSort('size')}
												className="font-medium hover:text-gray-100"
											>
												Size{sortArrow('size')}
											</button>
										</th>
										<th className="w-24 px-2 py-2"></th>
									</tr>
								</thead>
								<tbody>
									{sorted.map((result) => {
										const state = buttonState(
											result.id,
											sendingIds,
											sentIds,
											transferred
										);
										return (
											<tr
												key={result.id}
												className="border-t border-gray-700/60 align-top"
											>
												<td className="break-all px-2 py-2 text-gray-100">
													{result.isPack && (
														<span className="mr-2 whitespace-nowrap rounded border border-amber-500 bg-amber-900/30 px-1.5 py-0.5 text-xs text-amber-100">
															Season pack
														</span>
													)}
													{result.indexer && (
														<span className="mr-2 whitespace-nowrap rounded border border-gray-600 bg-gray-800 px-1.5 py-0.5 text-xs text-gray-400">
															{result.indexer}
														</span>
													)}
													{result.title}
												</td>
												<td className="whitespace-nowrap px-2 py-2 text-gray-300">
													{formatSize(result.size)}
												</td>
												<td className="px-2 py-2">
													<button
														type="button"
														onClick={() => send(result)}
														disabled={state.disabled}
														title={state.title}
														className={`haptic flex items-center gap-1 rounded border px-2 py-1 transition-colors duration-200 disabled:cursor-not-allowed ${
															state.kind === 'cached'
																? 'border-green-500 bg-green-900/30 text-green-100'
																: 'border-gray-500 bg-gray-800/60 text-gray-100 hover:bg-gray-700/50 disabled:opacity-60'
														}`}
													>
														{state.kind === 'sending' ? (
															<Loader2 className="h-3 w-3 animate-spin" />
														) : state.kind === 'cached' ||
														  state.kind === 'sent' ? (
															<Check className="h-3 w-3" />
														) : (
															<Send className="h-3 w-3" />
														)}
														{state.label}
													</button>
												</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						</div>
					)}
				</div>
			)}
		</div>
	);
};

export default UsenetResults;
