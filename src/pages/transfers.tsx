import { useRealDebridAccessToken } from '@/hooks/auth';
import {
	addTransferToRd,
	DebridUploaderJob,
	deleteDebridUploaderJob,
	getDebridUploaderJob,
	getTrackedDebridUploaderJobs,
	needsRdHandoff,
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
import { describeTransfer, PHASE_STYLES } from '@/utils/transferPhase';
import {
	isTerminal,
	ORIGIN_LABELS,
	ORIGIN_STYLES,
	originOf,
	toEntries,
	TransferEntry,
} from '@/utils/transfers';
import { CheckCircle2, Home, Loader2, RefreshCw, Send, Trash2, XCircle } from 'lucide-react';
import Head from 'next/head';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast, Toaster } from 'react-hot-toast';

const POLL_MS = 5000;

type JobState = { job?: DebridUploaderJob | Nzb2rdJob; errorText?: string };

export default function TransfersPage() {
	const [tracked, setTracked] = useState<TransferEntry[]>([]);
	const [states, setStates] = useState<Record<string, JobState>>({});
	const [isRefreshing, setIsRefreshing] = useState(false);
	const [rdKey] = useRealDebridAccessToken();
	// read inside the poll timer without re-arming it on every status change
	const statesRef = useRef(states);
	statesRef.current = states;
	// jobs whose RD handoff is running, so the 5s poll can't start a second one
	const handingOffRef = useRef(new Set<string>());
	const rdKeyRef = useRef(rdKey);
	rdKeyRef.current = rdKey;

	useEffect(() => {
		setTracked(toEntries(getTrackedDebridUploaderJobs(), getTrackedNzb2rdJobs()));
	}, []);

	// A transfer this browser joined rather than started belongs to the RD account
	// that created the job, so nothing puts it in *this* user's RD until a client
	// does. The send flow does it when the page that started it is still open;
	// this is the same handoff for everyone who navigated away meanwhile.
	const handOffToRd = useCallback(async (jobId: string, job: DebridUploaderJob) => {
		const key = rdKeyRef.current;
		if (!key || job.status !== 'completed' || !job.info_hash) return;
		if (handingOffRef.current.has(jobId)) return;
		const entry = getTrackedDebridUploaderJobs().find((j) => j.id === jobId);
		if (!needsRdHandoff(entry)) return;

		handingOffRef.current.add(jobId);
		try {
			if (await addTransferToRd(key, job.info_hash, jobId)) {
				toast.success(`${entry?.title || 'Transfer'} added to your Real-Debrid library!`);
			}
		} finally {
			handingOffRef.current.delete(jobId);
		}
	}, []);

	const refresh = useCallback(
		async (jobs: TransferEntry[], onlyActive: boolean) => {
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
						if (j.source === 'nzb2rd') {
							return [j.id, { job: await getNzb2rdJob(j.id, context, j.releaseId) }];
						}
						const job = await getDebridUploaderJob(j.id, context);
						// not awaited: the row's status shouldn't wait on RD
						void handOffToRd(j.id, job);
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
		},
		[handOffToRd]
	);

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
					Transfers put content into your Real-Debrid library, sourced from{' '}
					<span className="text-indigo-300">TorBox</span>,{' '}
					<span className="text-sky-300">AllDebrid</span> or{' '}
					<span className="text-amber-300">Usenet</span>. The first tag on each row is
					where its bytes came from — a TorBox/AllDebrid transfer shows{' '}
					<span className="text-slate-300">Cache</span> until the service settles on one.
					Jobs keep running on the server even if you close this page; the list below is
					remembered by this browser. Active jobs refresh every {POLL_MS / 1000}s.
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
							const progress = describeTransfer(t.source, job);
							const terminal = job && isTerminal(t.source, job.status);
							const chipStyle = PHASE_STYLES[progress.phase];
							const origin = originOf(
								t.source,
								(job as DebridUploaderJob | undefined)?.source
							);

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
													{job && !terminal && (
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
