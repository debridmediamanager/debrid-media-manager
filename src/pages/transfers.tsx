import {
	DebridUploaderJob,
	deleteDebridUploaderJob,
	getDebridUploaderJob,
	getTrackedDebridUploaderJobs,
	transferContextFromPath,
	untrackDebridUploaderJob,
} from '@/utils/debridUploader';
import {
	deleteNzb2rdJob,
	getNzb2rdJob,
	getTrackedNzb2rdJobs,
	Nzb2rdJob,
	untrackNzb2rdJob,
} from '@/utils/nzb2rd';
import {
	isTerminal,
	SOURCE_LABELS,
	SOURCE_STYLES,
	toEntries,
	TransferEntry,
} from '@/utils/transfers';
import { CheckCircle2, Home, Loader2, RefreshCw, Send, Trash2, XCircle } from 'lucide-react';
import Head from 'next/head';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast, Toaster } from 'react-hot-toast';

const POLL_MS = 5000;

const STATUS_STYLES: Record<string, string> = {
	pending: 'border-gray-500 bg-gray-900/30 text-gray-100',
	downloading: 'border-blue-500 bg-blue-900/30 text-blue-100',
	// nzb2rd's own stages, which have no TB → RD equivalent
	probing: 'border-blue-500 bg-blue-900/30 text-blue-100',
	fetching: 'border-blue-500 bg-blue-900/30 text-blue-100',
	unpacking: 'border-yellow-500 bg-yellow-900/30 text-yellow-100',
	hashing: 'border-yellow-500 bg-yellow-900/30 text-yellow-100',
	preparing: 'border-yellow-500 bg-yellow-900/30 text-yellow-100',
	uploading: 'border-purple-500 bg-purple-900/30 text-purple-100',
	completed: 'border-green-500 bg-green-900/30 text-green-100',
	failed: 'border-red-500 bg-red-900/30 text-red-100',
	unknown: 'border-gray-500 bg-gray-900/30 text-gray-400',
};

type JobState = { job?: DebridUploaderJob | Nzb2rdJob; errorText?: string };

export default function TransfersPage() {
	const [tracked, setTracked] = useState<TransferEntry[]>([]);
	const [states, setStates] = useState<Record<string, JobState>>({});
	const [isRefreshing, setIsRefreshing] = useState(false);
	// read inside the poll timer without re-arming it on every status change
	const statesRef = useRef(states);
	statesRef.current = states;

	useEffect(() => {
		setTracked(toEntries(getTrackedDebridUploaderJobs(), getTrackedNzb2rdJobs()));
	}, []);

	const refresh = useCallback(async (jobs: TransferEntry[], onlyActive: boolean) => {
		const toPoll = onlyActive
			? jobs.filter((j) => {
					const status = statesRef.current[j.id]?.job?.status;
					return !status || !isTerminal(j.source, status);
				})
			: jobs;
		if (toPoll.length === 0) return;

		const results = await Promise.all(
			toPoll.map(async (j): Promise<[string, JobState]> => {
				try {
					const context = transferContextFromPath(j.returnPath);
					const job =
						j.source === 'nzb2rd'
							? await getNzb2rdJob(j.id, context, j.releaseId)
							: await getDebridUploaderJob(j.id, context);
					return [j.id, { job }];
				} catch (error) {
					return [
						j.id,
						{ errorText: error instanceof Error ? error.message : 'unreachable' },
					];
				}
			})
		);
		setStates((prev) => ({ ...prev, ...Object.fromEntries(results) }));
	}, []);

	// initial fetch + steady polling of non-terminal jobs
	useEffect(() => {
		if (tracked.length === 0) return;
		refresh(tracked, false);
		const interval = setInterval(() => refresh(tracked, true), POLL_MS);
		return () => clearInterval(interval);
	}, [tracked, refresh]);

	const handleRefreshAll = async () => {
		if (isRefreshing) return;
		setIsRefreshing(true);
		try {
			await refresh(tracked, false);
		} finally {
			setIsRefreshing(false);
		}
	};

	const removeFromList = (entry: TransferEntry) => {
		if (entry.source === 'nzb2rd') untrackNzb2rdJob(entry.id);
		else untrackDebridUploaderJob(entry.id);
		setTracked((prev) => prev.filter((j) => j.id !== entry.id));
	};

	const handleCancel = async (entry: TransferEntry) => {
		if (!window.confirm('Cancel this transfer? The job will be stopped and deleted.')) return;
		try {
			if (entry.source === 'nzb2rd') await deleteNzb2rdJob(entry.id, entry.releaseId);
			else await deleteDebridUploaderJob(entry.id);
			removeFromList(entry);
			toast.success('Transfer cancelled.');
		} catch (error) {
			toast.error(
				`Failed to cancel: ${error instanceof Error ? error.message : 'unreachable'}`
			);
		}
	};

	return (
		<div className="flex min-h-screen flex-col items-center bg-gray-900 p-4">
			<Head>
				<title>Debrid Media Manager - Transfers</title>
			</Head>
			<Toaster position="bottom-right" />

			<div className="w-full max-w-3xl">
				<div className="mb-4 flex items-center justify-between">
					<h1 className="flex items-center text-xl font-bold text-white">
						<Send className="mr-2 h-5 w-5 text-indigo-400" />
						Transfers
					</h1>
					<div className="flex items-center gap-2">
						<button
							onClick={handleRefreshAll}
							disabled={isRefreshing || tracked.length === 0}
							className={`haptic-sm rounded border-2 border-indigo-500 bg-indigo-900/30 p-2 text-indigo-100 transition-colors hover:bg-indigo-800/50 ${isRefreshing || tracked.length === 0 ? 'cursor-not-allowed opacity-50' : ''}`}
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
					Transfers put content into your Real-Debrid library — either from a
					TorBox/AllDebrid cache (<span className="text-indigo-300">TB → RD</span>) or off
					Usenet (<span className="text-amber-300">Usenet</span>). Jobs keep running on
					the server even if you close this page; the list below is remembered by this
					browser. Active jobs refresh every {POLL_MS / 1000}s.
				</p>

				{tracked.length === 0 ? (
					<div className="rounded border-2 border-gray-700 bg-gray-800/30 p-6 text-center text-sm text-gray-300">
						No transfers yet. Start one from any TorBox-cached search result with the
						&quot;TB → RD&quot; button, or from the Usenet section on a movie or show
						page.
					</div>
				) : (
					<div className="space-y-2">
						{tracked.map((t) => {
							const state = states[t.id];
							const job = state?.job;
							const status = job?.status ?? 'unknown';
							const terminal = job && isTerminal(t.source, job.status);
							const chipStyle = STATUS_STYLES[status] ?? STATUS_STYLES.unknown;

							return (
								<div
									key={t.id}
									className="rounded-lg border-2 border-gray-700 bg-gray-800/30 p-3"
								>
									<div className="flex items-start justify-between gap-2">
										<div className="min-w-0 flex-1">
											<h2 className="truncate text-sm font-bold text-white">
												{job?.name || t.title || t.id}
											</h2>
											<div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-400">
												<span
													className={`inline-flex items-center rounded border-2 px-1.5 py-0.5 font-medium ${SOURCE_STYLES[t.source]}`}
												>
													{SOURCE_LABELS[t.source]}
												</span>
												<span
													className={`inline-flex items-center rounded border-2 px-1.5 py-0.5 font-medium ${chipStyle}`}
												>
													{status === 'completed' && (
														<CheckCircle2 className="mr-1 h-3 w-3" />
													)}
													{status === 'failed' && (
														<XCircle className="mr-1 h-3 w-3" />
													)}
													{job && !terminal && (
														<Loader2 className="mr-1 h-3 w-3 animate-spin" />
													)}
													{status}
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
											{job?.status_message && !terminal && (
												<div className="mt-1 text-xs text-gray-300">
													{job.status_message}
												</div>
											)}
											{job?.status === 'failed' && job.error && (
												<div className="mt-1 break-words text-xs text-red-300">
													{job.error}
												</div>
											)}
											{state?.errorText && !job && (
												<div className="mt-1 text-xs text-yellow-300">
													Status unavailable: {state.errorText}
												</div>
											)}
										</div>
										<div className="flex shrink-0 items-center gap-1">
											{job && !terminal ? (
												<button
													onClick={() => handleCancel(t)}
													className="haptic-sm rounded border-2 border-red-500 bg-red-900/30 p-1.5 text-red-100 transition-colors hover:bg-red-800/50"
													title="Cancel transfer"
												>
													<XCircle className="h-4 w-4" />
												</button>
											) : (
												<button
													onClick={() => removeFromList(t)}
													className="haptic-sm rounded border-2 border-gray-500 bg-gray-800/30 p-1.5 text-gray-100 transition-colors hover:bg-gray-700/50"
													title="Remove from list"
												>
													<Trash2 className="h-4 w-4" />
												</button>
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
