import { AdminFetch, AdminLayout } from '@/components/admin/AdminLayout';
import type { AdminReport } from '@/pages/api/admin/reports';
import { useCallback, useEffect, useState } from 'react';

// Reported releases wait here; only an approval hides one, and only on that title.

const STATUSES = [
	['pending', 'Waiting'],
	['approved', 'Hidden'],
	['dismissed', 'Kept'],
] as const;
type Status = (typeof STATUSES)[number][0];
type Action = 'approve' | 'dismiss' | 'reopen';

const PAGE_SIZE = 25;

const TYPE_LABEL: Record<string, string> = {
	porn: 'adult',
	wrong_imdb: 'wrong title',
	wrong_season: 'wrong season',
	malware: 'malware',
};

function ReportCard({
	report,
	onAction,
}: {
	report: AdminReport;
	onAction: (report: AdminReport, action: Action, note: string) => Promise<void>;
}) {
	const [note, setNote] = useState(report.note ?? '');
	const [busy, setBusy] = useState(false);
	const act = async (action: Action) => {
		setBusy(true);
		try {
			await onAction(report, action, note);
		} finally {
			setBusy(false);
		}
	};
	const button = 'rounded px-3 py-1 text-sm font-semibold disabled:opacity-50';

	return (
		<section className="rounded border-2 border-gray-600 bg-gray-800/30 p-4 text-sm text-gray-200">
			<h2 className="font-mono text-sm break-all text-gray-100">
				{report.filename ?? <span className="text-gray-400">name not on file</span>}
			</h2>
			<p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-400">
				<a
					href={`https://www.imdb.com/title/${report.imdbId}/`}
					target="_blank"
					rel="noreferrer noopener"
					className="text-cyan-300 underline"
				>
					{report.imdbId}
				</a>
				<span className="font-mono break-all" title={report.hash}>
					{report.hash.slice(0, 12)}
				</span>
				<span>{new Date(report.lastReportedAt).toLocaleString()}</span>
			</p>
			<p className="mt-2 flex flex-wrap gap-2 text-xs">
				{report.types.map((type) => (
					<span key={type} className="rounded bg-gray-700 px-2 py-0.5 text-gray-200">
						{TYPE_LABEL[type] ?? type}
					</span>
				))}
				<span className="rounded bg-gray-700 px-2 py-0.5 text-gray-200">
					{report.reporters} {report.reporters === 1 ? 'reporter' : 'reporters'}
				</span>
				{report.modelAgrees ? (
					<span className="rounded bg-yellow-900/60 px-2 py-0.5 text-yellow-200">
						model agrees
					</span>
				) : null}
			</p>
			<input
				value={note}
				onChange={(event) => setNote(event.target.value)}
				placeholder="Note (optional)"
				className="mt-3 w-full rounded border border-gray-600 bg-gray-900/60 px-2 py-1 text-sm text-gray-100"
			/>
			<div className="mt-2 flex flex-wrap gap-2">
				{report.decision !== 'approved' ? (
					<button
						disabled={busy}
						onClick={() => act('approve')}
						className={`${button} bg-red-800 text-white hover:bg-red-700`}
					>
						Hide on this title
					</button>
				) : null}
				{report.decision === null ? (
					<button
						disabled={busy}
						onClick={() => act('dismiss')}
						className={`${button} border border-gray-600 text-gray-200 hover:bg-gray-800`}
					>
						Keep it
					</button>
				) : (
					<button
						disabled={busy}
						onClick={() => act('reopen')}
						className={`${button} border border-gray-600 text-gray-200 hover:bg-gray-800`}
					>
						{report.decision === 'approved' ? 'Show it again' : 'Back to waiting'}
					</button>
				)}
			</div>
		</section>
	);
}

function Reports({ adminFetch }: { adminFetch: AdminFetch }) {
	const [status, setStatus] = useState<Status>('pending');
	const [page, setPage] = useState(0);
	const [data, setData] = useState<{ total: number; items: AdminReport[] } | null>(null);
	const [message, setMessage] = useState<string | null>(null);

	const load = useCallback(async () => {
		const res = await adminFetch(`/api/admin/reports?status=${status}&page=${page}`);
		if (!res.ok) {
			setData(null);
			if (res.status !== 401) setMessage(`Loading failed (${res.status}).`);
			return;
		}
		setData(await res.json());
	}, [adminFetch, status, page]);

	useEffect(() => {
		void load();
	}, [load]);

	const onAction = async (report: AdminReport, action: Action, note: string) => {
		const res = await adminFetch('/api/admin/reports', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ imdbId: report.imdbId, hash: report.hash, action, note }),
		});
		const reply = await res.json().catch(() => ({}));
		if (!res.ok) {
			setMessage(reply.error ?? `That failed (${res.status}).`);
			return;
		}
		setMessage(
			action === 'approve'
				? 'Hidden on that title.'
				: action === 'dismiss'
					? 'Kept. New reports on it will not bring it back here.'
					: 'Back in the queue.'
		);
		await load();
	};

	const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

	return (
		<>
			<div className="flex flex-wrap gap-2">
				{STATUSES.map(([key, label]) => (
					<button
						key={key}
						onClick={() => {
							setMessage(null);
							setPage(0);
							setStatus(key);
						}}
						className={`rounded px-3 py-1 text-sm ${
							key === status
								? 'bg-gray-200 text-gray-900'
								: 'border border-gray-600 text-gray-300 hover:bg-gray-800'
						}`}
					>
						{label}
						{key === status && data ? ` (${data.total})` : ''}
					</button>
				))}
			</div>
			{message ? <p className="text-sm text-yellow-300">{message}</p> : null}
			{data?.items.length === 0 ? (
				<p className="text-sm text-gray-400">Nothing here.</p>
			) : null}
			{data?.items.map((report) => (
				<ReportCard
					key={`${report.imdbId}:${report.hash}:${report.decision}`}
					report={report}
					onAction={onAction}
				/>
			))}
			{data && pages > 1 ? (
				<div className="flex items-center justify-between text-sm text-gray-300">
					<button
						disabled={page === 0}
						onClick={() => setPage(page - 1)}
						className="rounded border border-gray-600 px-3 py-1 hover:bg-gray-800 disabled:opacity-40"
					>
						Newer
					</button>
					<span>
						Page {page + 1} of {pages}
					</span>
					<button
						disabled={page + 1 >= pages}
						onClick={() => setPage(page + 1)}
						className="rounded border border-gray-600 px-3 py-1 hover:bg-gray-800 disabled:opacity-40"
					>
						Older
					</button>
				</div>
			) : null}
		</>
	);
}

export default function ReportsAdminPage() {
	return (
		<AdminLayout title="Reported releases">
			{(adminFetch) => <Reports adminFetch={adminFetch} />}
		</AdminLayout>
	);
}
