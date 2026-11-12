import { AdminFetch, AdminLayout } from '@/components/admin/AdminLayout';
import Poster from '@/components/poster';
import type { AdminReport, Inspection } from '@/pages/api/admin/reports';
import {
	type AllDebridFile,
	lookInsideAllDebrid,
	playableLink,
	readAllDebridKey,
	saveAllDebridKey,
} from '@/utils/adminAllDebrid';
import { useCallback, useEffect, useState } from 'react';

// Reported releases the model could not settle wait here; hiding one hides it on that title only.

const STATUSES = [
	['pending', 'Waiting'],
	['approved', 'Hidden'],
	['dismissed', 'Kept'],
] as const;
type Status = (typeof STATUSES)[number][0];
// A report the model confirms is hidden on its own, so what waits is what it disputed
// or could not judge: this queue is the only human check.
const MODEL_FILTERS = [
	['all', 'All'],
	['disagrees', 'Model disagrees'],
	['unjudged', 'Not judged'],
] as const;
type ModelFilter = (typeof MODEL_FILTERS)[number][0];
type ReportsPage = {
	total: number;
	items: AdminReport[];
	counts?: Record<ModelFilter, number>;
};
type Action = 'approve' | 'dismiss' | 'reopen';

const PAGE_SIZE = 25;

const TYPE_LABEL: Record<string, string> = {
	porn: 'adult',
	wrong_imdb: 'wrong title',
	wrong_season: 'wrong season',
	malware: 'malware',
};

const gb = (bytes: number) =>
	bytes >= 1e9
		? `${(bytes / 1e9).toFixed(2)} GB`
		: bytes >= 1e6
			? `${Math.round(bytes / 1e6)} MB`
			: '<1 MB';

const PROVIDER_NAME = {
	premiumize: 'Premiumize',
	realdebrid: 'Real-Debrid',
	torbox: 'TorBox',
} as const;

/** On a Mac, play hands the stream to IINA; elsewhere it opens in a browser tab. */
const isMac = () =>
	typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent);
const iina = (url: string) => `iina://weblink?url=${encodeURIComponent(url)}`;

const PLAYABLE = /\.(mkv|mp4|m4v|avi|ts|m2ts|webm|mov|wmv|mpg)$/i;

type Inspected = Inspection | { error: string } | 'loading';

function ReportCard({
	report,
	onAction,
	onInspect,
	adKey,
	onRemoveSeason,
}: {
	report: AdminReport;
	onAction: (report: AdminReport, action: Action, note: string) => Promise<void>;
	onInspect: (hash: string) => Promise<Exclude<Inspected, 'loading'>>;
	/** The admin's AllDebrid key from this browser, '' when none. */
	adKey: string;
	onRemoveSeason: (report: AdminReport, season: number) => Promise<void>;
}) {
	const [note, setNote] = useState(report.note ?? '');
	const [busy, setBusy] = useState(false);
	const [inside, setInside] = useState<Inspected | null>(null);
	const [adInside, setAdInside] = useState<
		{ cached: boolean; files: AllDebridFile[] } | { error: string } | 'loading' | null
	>(null);
	// Premiumize answers with play links; anything less falls through to AllDebrid in this browser.
	const lookInside = async () => {
		setAdInside(null);
		setInside('loading');
		const server = await onInspect(report.hash);
		setInside(server);
		if (!adKey || ('cached' in server && server.cached && server.provider === 'premiumize'))
			return;
		setAdInside('loading');
		try {
			setAdInside(await lookInsideAllDebrid(adKey, report.hash));
		} catch (error) {
			setAdInside({ error: `AllDebrid: ${error instanceof Error ? error.message : error}` });
		}
	};
	// The tab opens on the click itself, before the unlock answers, or the browser blocks it.
	// Decided after mount: the server render has no navigator.
	const [mac, setMac] = useState(false);
	useEffect(() => setMac(isMac()), []);
	const playAd = async (link: string) => {
		if (mac) {
			try {
				window.open(iina(await playableLink(adKey, link)), '_self');
			} catch (error) {
				setAdInside({
					error: `AllDebrid: ${error instanceof Error ? error.message : error}`,
				});
			}
			return;
		}
		const tab = window.open('', '_blank');
		try {
			const url = await playableLink(adKey, link);
			if (tab) tab.location.href = url;
			else window.open(url, '_blank');
		} catch (error) {
			tab?.close();
			setAdInside({ error: `AllDebrid: ${error instanceof Error ? error.message : error}` });
		}
	};
	const playHint = adKey ? '' : 'To play it, add an AllDebrid key at the top, or use the magnet.';
	const adHasIt =
		typeof adInside === 'object' &&
		adInside !== null &&
		'cached' in adInside &&
		adInside.cached;
	const magnet = `magnet:?xt=urn:btih:${report.hash}${report.filename ? `&dn=${encodeURIComponent(report.filename)}` : ''}`;
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
		<section className="flex gap-3 rounded border-2 border-gray-600 bg-gray-800/30 p-4 text-sm text-gray-200 sm:gap-4">
			<span className="block w-14 shrink-0 sm:w-20">
				<Poster imdbId={report.imdbId} title={report.title ?? report.imdbId} />
			</span>
			<div className="min-w-0 flex-1">
				{report.title ? (
					<a
						href={`/${report.kind === 'show' ? 'show' : 'movie'}/${report.imdbId}`}
						target="_blank"
						rel="noreferrer noopener"
						className="text-base font-semibold text-gray-100 hover:underline"
					>
						{report.title}
						{report.year ? ` (${report.year})` : ''}
					</a>
				) : null}
				<h2 className="mt-1 font-mono text-sm break-all text-gray-300">
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
					<a href={magnet} className="text-cyan-300 underline">
						magnet
					</a>
				</p>
				{report.seasons.length > 0 ? (
					<p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-400">
						Listed on
						{report.seasons.map((season) => (
							<span key={season} className="inline-flex items-center gap-1">
								<a
									href={`/show/${report.imdbId}/${season}`}
									target="_blank"
									rel="noreferrer noopener"
									className="rounded bg-indigo-900/60 px-2 py-0.5 text-indigo-200 hover:bg-indigo-800"
								>
									{season === 0 ? 'specials' : `season ${season}`}
								</a>
								<button
									disabled={busy}
									onClick={async () => {
										if (
											!window.confirm(
												report.seasons.length > 1
													? `Remove this release from season ${season} only? It stays on the other seasons.`
													: `Remove this release from season ${season}? That is its only season, so it gets hidden.`
											)
										)
											return;
										setBusy(true);
										try {
											await onRemoveSeason(report, season);
										} finally {
											setBusy(false);
										}
									}}
									className="text-gray-400 underline hover:text-gray-200 disabled:opacity-50"
								>
									remove
								</button>
							</span>
						))}
					</p>
				) : null}
				<p className="mt-2 flex flex-wrap gap-2 text-xs">
					{report.types.map((type) => (
						<span key={type} className="rounded bg-gray-700 px-2 py-0.5 text-gray-200">
							{TYPE_LABEL[type] ?? type}
						</span>
					))}
					<span className="rounded bg-gray-700 px-2 py-0.5 text-gray-200">
						{report.reporters} {report.reporters === 1 ? 'reporter' : 'reporters'}
					</span>
					{report.model === 'agrees' ? (
						<span className="rounded bg-yellow-900/60 px-2 py-0.5 text-yellow-200">
							model agrees
						</span>
					) : report.model === 'disagrees' ? (
						<span className="rounded bg-cyan-900/60 px-2 py-0.5 text-cyan-200">
							model disagrees
						</span>
					) : null}
				</p>
				{inside === null || adHasIt ? null : inside === 'loading' ? (
					<p className="mt-3 text-xs text-gray-400">Looking inside…</p>
				) : 'error' in inside ? (
					<p className="mt-3 text-xs text-yellow-300">{inside.error}</p>
				) : !inside.cached ? (
					<p className="mt-3 text-xs text-gray-400">
						No provider here has it. {playHint}
					</p>
				) : (
					<>
						<p className="mt-3 text-xs text-gray-400">
							From {PROVIDER_NAME[inside.provider ?? 'premiumize']}
							{inside.provider === 'premiumize'
								? ''
								: `: the file list only. ${playHint}`}
						</p>
						<ul className="mt-1 max-h-64 space-y-1 overflow-auto rounded bg-gray-900/60 p-2 text-xs">
							{inside.files.map((file) => (
								<li
									key={file.path}
									className="flex flex-wrap items-baseline gap-x-2"
								>
									<span
										title={file.path}
										className="min-w-0 flex-1 font-mono break-all text-gray-200"
									>
										{file.path.split('/').pop()}
									</span>
									<span className="text-gray-400">{gb(file.size)}</span>
									{file.link && PLAYABLE.test(file.path) ? (
										<a
											href={
												mac
													? iina(file.link)
													: (file.streamLink ?? file.link)
											}
											target={mac ? undefined : '_blank'}
											rel="noreferrer noopener"
											className="text-cyan-300 underline"
										>
											{mac ? 'play in IINA' : 'play'}
										</a>
									) : null}
									{file.link ? (
										<a href={file.link} className="text-cyan-300 underline">
											download
										</a>
									) : null}
								</li>
							))}
						</ul>
					</>
				)}
				{adInside === null ? null : adInside === 'loading' ? (
					<p className="mt-3 text-xs text-gray-400">Asking AllDebrid…</p>
				) : 'error' in adInside ? (
					<p className="mt-3 text-xs text-yellow-300">{adInside.error}</p>
				) : !adInside.cached ? (
					<p className="mt-1 text-xs text-gray-400">Not cached on AllDebrid.</p>
				) : (
					<>
						<p className="mt-3 text-xs text-gray-400">
							From AllDebrid, played from this browser
						</p>
						<ul className="mt-1 max-h-64 space-y-1 overflow-auto rounded bg-gray-900/60 p-2 text-xs">
							{adInside.files.map((file) => (
								<li
									key={file.link}
									className="flex flex-wrap items-baseline gap-x-2"
								>
									<span className="min-w-0 flex-1 font-mono break-all text-gray-200">
										{file.path}
									</span>
									<span className="text-gray-400">{gb(file.size)}</span>
									{PLAYABLE.test(file.path) ? (
										<button
											onClick={() => void playAd(file.link)}
											className="text-cyan-300 underline"
										>
											{mac ? 'play in IINA' : 'play'}
										</button>
									) : null}
								</li>
							))}
						</ul>
					</>
				)}
				<input
					value={note}
					onChange={(event) => setNote(event.target.value)}
					placeholder="Note (optional)"
					className="mt-3 w-full rounded border border-gray-600 bg-gray-900/60 px-2 py-1 text-sm text-gray-100"
				/>
				<div className="mt-2 flex flex-wrap gap-2">
					<button
						disabled={inside === 'loading' || adInside === 'loading'}
						onClick={() => void lookInside()}
						className={`${button} border border-gray-600 text-gray-200 hover:bg-gray-800`}
					>
						Look inside
					</button>
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
			</div>
		</section>
	);
}

/** The AllDebrid key lives in this browser only: AllDebrid refuses adds from DMM's servers. */
function AllDebridKeyField({
	value,
	onChange,
}: {
	value: string;
	onChange: (key: string) => void;
}) {
	const [editing, setEditing] = useState(false);
	if (value && !editing) {
		return (
			<p className="text-xs text-gray-400">
				AllDebrid key in this browser (…{value.slice(-3)}) ·{' '}
				<button onClick={() => setEditing(true)} className="text-cyan-300 underline">
					change
				</button>{' '}
				·{' '}
				<button
					onClick={() => {
						saveAllDebridKey('');
						onChange('');
					}}
					className="text-cyan-300 underline"
				>
					remove
				</button>
			</p>
		);
	}
	return (
		<form
			className="flex flex-wrap items-center gap-2 text-xs text-gray-400"
			onSubmit={(event) => {
				event.preventDefault();
				const key = new FormData(event.currentTarget).get('adKey')?.toString().trim() ?? '';
				saveAllDebridKey(key);
				onChange(key);
				setEditing(false);
			}}
		>
			<span>To play through AllDebrid, add a key. It stays in this browser:</span>
			<input
				name="adKey"
				type="password"
				autoComplete="off"
				placeholder="AllDebrid API key"
				className="min-w-0 flex-1 rounded border border-gray-600 bg-gray-900/60 px-2 py-1 text-sm text-gray-100"
			/>
			<button className="rounded border border-gray-600 px-3 py-1 text-gray-200 hover:bg-gray-800">
				Save
			</button>
		</form>
	);
}

function Reports({ adminFetch }: { adminFetch: AdminFetch }) {
	const [adKey, setAdKey] = useState('');
	useEffect(() => setAdKey(readAllDebridKey()), []);
	const [status, setStatus] = useState<Status>('pending');
	const [model, setModel] = useState<ModelFilter>('all');
	const [page, setPage] = useState(0);
	const [data, setData] = useState<ReportsPage | null>(null);
	const [message, setMessage] = useState<string | null>(null);

	const load = useCallback(async () => {
		const res = await adminFetch(
			`/api/admin/reports?status=${status}&model=${model}&page=${page}`
		);
		if (!res.ok) {
			setData(null);
			if (res.status !== 401) setMessage(`Loading failed (${res.status}).`);
			return;
		}
		setData(await res.json());
	}, [adminFetch, status, model, page]);

	useEffect(() => {
		void load();
	}, [load]);

	const onInspect = async (hash: string) => {
		const res = await adminFetch('/api/admin/reports', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ action: 'inspect', hash }),
		});
		const reply = await res.json().catch(() => ({}));
		return res.ok
			? (reply as Inspection)
			: { error: reply.error ?? `Looking inside failed (${res.status}).` };
	};

	const onRemoveSeason = async (report: AdminReport, season: number) => {
		const res = await adminFetch('/api/admin/reports', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				imdbId: report.imdbId,
				hash: report.hash,
				action: 'removeFromSeason',
				season,
			}),
		});
		const reply = await res.json().catch(() => ({}));
		if (!res.ok) {
			setMessage(reply.error ?? `That failed (${res.status}).`);
			return;
		}
		setMessage(
			reply.remaining?.length
				? `Removed from season ${season}; it stays on season ${reply.remaining.join(', ')}.`
				: `Removed from season ${season}, its only season, so it is hidden.`
		);
		await load();
	};

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

	const keepDisputed = async () => {
		const count = data?.counts?.disagrees ?? 0;
		if (
			!window.confirm(
				`Keep all ${count} releases the model disagreed with? They stay visible.`
			)
		) {
			return;
		}
		const res = await adminFetch('/api/admin/reports', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ action: 'keepModelDisputed' }),
		});
		const reply = await res.json().catch(() => ({}));
		setMessage(
			res.ok
				? `Kept ${reply.kept} releases.`
				: (reply.error ?? `That failed (${res.status}).`)
		);
		setPage(0);
		await load();
	};

	const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

	return (
		<>
			<AllDebridKeyField value={adKey} onChange={setAdKey} />
			<div className="flex flex-wrap gap-2">
				{STATUSES.map(([key, label]) => (
					<button
						key={key}
						onClick={() => {
							setMessage(null);
							setPage(0);
							setModel('all');
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
			{status === 'pending' && data?.counts ? (
				<div className="flex flex-wrap items-center gap-2 text-xs">
					{MODEL_FILTERS.map(([key, label]) => (
						<button
							key={key}
							onClick={() => {
								setMessage(null);
								setPage(0);
								setModel(key);
							}}
							className={`rounded-full px-3 py-1 ${
								key === model
									? 'bg-cyan-800 text-white'
									: 'border border-gray-600 text-gray-300 hover:bg-gray-800'
							}`}
						>
							{label} ({data.counts![key]})
						</button>
					))}
					{model === 'disagrees' && data.counts.disagrees > 0 ? (
						<button
							onClick={() => void keepDisputed()}
							className="rounded border border-gray-500 px-3 py-1 text-gray-100 hover:bg-gray-800"
						>
							Keep all {data.counts.disagrees}
						</button>
					) : null}
				</div>
			) : null}
			{message ? <p className="text-sm text-yellow-300">{message}</p> : null}
			{data?.items.length === 0 ? (
				<p className="text-sm text-gray-400">Nothing here.</p>
			) : null}
			{data?.items.map((report) => (
				<ReportCard
					key={`${report.imdbId}:${report.hash}:${report.decision}`}
					report={report}
					onAction={onAction}
					onInspect={onInspect}
					adKey={adKey}
					onRemoveSeason={onRemoveSeason}
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
