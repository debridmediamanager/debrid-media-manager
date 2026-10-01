import { Logo } from '@/components/Logo';
import Head from 'next/head';
import { useCallback, useEffect, useState } from 'react';

// The review queue for copyright notices. The token is TAKEDOWN_ADMIN_TOKEN;
// the API checks it on every call, so this page holds no secret of its own.

type Notice = {
	id: string;
	status: 'pending' | 'approved' | 'rejected';
	claimantName: string;
	claimantEmail: string;
	representing: string | null;
	work: string;
	reason: string;
	locations: string;
	hashes: string[];
	releases: string[];
	hashlistIds: string[];
	submitterIp: string | null;
	reviewNote: string | null;
	reviewedAt: string | null;
	createdAt: string;
};

const TOKEN_KEY = 'dmm:takedownAdminToken';
const STATUSES = ['pending', 'approved', 'rejected'] as const;

const readToken = () => {
	try {
		return localStorage.getItem(TOKEN_KEY) ?? '';
	} catch {
		return '';
	}
};

const saveToken = (token: string) => {
	try {
		localStorage.setItem(TOKEN_KEY, token);
	} catch {
		// A private window keeps the token for this visit only.
	}
};

function NoticeCard({
	notice,
	onAction,
}: {
	notice: Notice;
	onAction: (id: string, action: 'approve' | 'reject', note: string) => Promise<void>;
}) {
	const [note, setNote] = useState(notice.reviewNote ?? '');
	const [busy, setBusy] = useState(false);
	const act = async (action: 'approve' | 'reject') => {
		setBusy(true);
		try {
			await onAction(notice.id, action, note);
		} finally {
			setBusy(false);
		}
	};

	return (
		<section className="rounded border-2 border-gray-600 bg-gray-800/30 p-4 text-sm text-gray-200">
			<div className="flex flex-wrap items-baseline justify-between gap-2">
				<h2 className="text-base font-semibold text-gray-100">
					{notice.work.slice(0, 140)}
				</h2>
				<span className="font-mono text-xs text-gray-400">
					{new Date(notice.createdAt).toLocaleString()} · {notice.id}
				</span>
			</div>
			<p className="mt-1 text-gray-300">
				{notice.claimantName} &lt;{notice.claimantEmail}&gt;
				{notice.representing ? ` for ${notice.representing}` : ''}
				{notice.submitterIp ? ` · ${notice.submitterIp}` : ''}
			</p>
			<p className="mt-2 whitespace-pre-wrap text-gray-300">{notice.reason}</p>
			<p className="mt-2 text-xs text-gray-400">
				{notice.hashes.length} hashes · {notice.releases.length} releases ·{' '}
				{notice.hashlistIds.length} share pages
			</p>
			<details className="mt-2">
				<summary className="cursor-pointer text-xs text-cyan-300">What was parsed</summary>
				<pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-gray-900/70 p-2 font-mono text-xs text-gray-300">
					{[...notice.hashes, ...notice.releases, ...notice.hashlistIds].join('\n')}
				</pre>
			</details>
			<details className="mt-1">
				<summary className="cursor-pointer text-xs text-cyan-300">As submitted</summary>
				<pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-gray-900/70 p-2 font-mono text-xs text-gray-300">
					{notice.locations}
				</pre>
			</details>
			<textarea
				className="mt-3 w-full rounded border border-gray-600 bg-gray-900/60 px-2 py-1 text-sm text-gray-100"
				rows={2}
				placeholder="Review note"
				value={note}
				onChange={(event) => setNote(event.target.value)}
			/>
			<div className="mt-2 flex gap-2">
				{notice.status !== 'approved' ? (
					<button
						disabled={busy}
						onClick={() => act('approve')}
						className="rounded bg-green-700 px-3 py-1 text-sm font-semibold text-white hover:bg-green-600 disabled:opacity-50"
					>
						Approve and block
					</button>
				) : null}
				{notice.status !== 'rejected' ? (
					<button
						disabled={busy}
						onClick={() => act('reject')}
						className="rounded bg-red-800 px-3 py-1 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
					>
						{notice.status === 'approved' ? 'Reverse' : 'Reject'}
					</button>
				) : null}
			</div>
		</section>
	);
}

export default function CopyrightAdminPage() {
	const [token, setToken] = useState('');
	const [status, setStatus] = useState<(typeof STATUSES)[number]>('pending');
	const [notices, setNotices] = useState<Notice[] | null>(null);
	const [message, setMessage] = useState<string | null>(null);

	useEffect(() => setToken(readToken()), []);

	const load = useCallback(async () => {
		if (!token) return;
		const res = await fetch(`/api/takedown/admin?status=${status}`, {
			headers: { Authorization: `Bearer ${token}` },
		});
		if (!res.ok) {
			setNotices(null);
			setMessage(
				res.status === 401 ? 'The token was refused.' : `Loading failed (${res.status}).`
			);
			return;
		}
		setNotices((await res.json()).notices);
	}, [token, status]);

	useEffect(() => {
		void load();
	}, [load]);

	const onAction = async (id: string, action: 'approve' | 'reject', note: string) => {
		const res = await fetch('/api/takedown/admin', {
			method: 'POST',
			headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({ id, action, note }),
		});
		const body = await res.json().catch(() => ({}));
		if (!res.ok) {
			setMessage(body.error ?? `The ${action} failed (${res.status}).`);
			return;
		}
		const pages = body.hashlists;
		setMessage(
			action === 'approve'
				? pages?.error
					? `Approved. Share pages were not deleted: ${pages.error}. Approve again to retry.`
					: `Approved. ${pages?.deleted?.length ?? 0} share pages deleted.`
				: 'Rejected.'
		);
		await load();
	};

	return (
		<div className="flex min-h-screen flex-col items-center bg-gray-900 p-4">
			<Head>
				<title>Debrid Media Manager - Copyright review</title>
				<meta name="robots" content="noindex, nofollow" />
			</Head>
			<Logo />
			<div className="mt-6 flex w-full max-w-4xl flex-col gap-4 pb-16">
				<h1 className="text-2xl font-bold text-gray-100">Copyright notices</h1>
				<form
					className="flex gap-2"
					onSubmit={(event) => {
						event.preventDefault();
						const value =
							new FormData(event.currentTarget).get('token')?.toString() ?? '';
						saveToken(value);
						setMessage(null);
						setToken(value);
					}}
				>
					<input
						name="token"
						type="password"
						defaultValue={token}
						key={token}
						placeholder="Admin token"
						className="flex-1 rounded border border-gray-600 bg-gray-900/60 px-3 py-2 text-sm text-gray-100"
					/>
					<button className="rounded bg-cyan-700 px-3 py-2 text-sm font-semibold text-white hover:bg-cyan-600">
						Use token
					</button>
				</form>
				<div className="flex gap-2">
					{STATUSES.map((s) => (
						<button
							key={s}
							onClick={() => {
								setMessage(null);
								setStatus(s);
							}}
							className={`rounded px-3 py-1 text-sm ${
								s === status
									? 'bg-gray-200 text-gray-900'
									: 'border border-gray-600 text-gray-300 hover:bg-gray-800'
							}`}
						>
							{s}
						</button>
					))}
				</div>
				{message ? <p className="text-sm text-yellow-300">{message}</p> : null}
				{notices?.length === 0 ? (
					<p className="text-sm text-gray-400">Nothing here.</p>
				) : null}
				{notices?.map((notice) => (
					<NoticeCard key={notice.id} notice={notice} onAction={onAction} />
				))}
			</div>
		</div>
	);
}
