import { AdminFetch, AdminLayout } from '@/components/admin/AdminLayout';
import type { AdminIndexer } from '@/pages/api/newznab/admin';
import { FormEvent, useCallback, useEffect, useState } from 'react';

// The Newznab aggregator's upstream indexers. The API never sends a stored API key back.

const WINDOWS: [number, string][] = [
	[60, 'minute'],
	[3600, 'hour'],
	[86400, 'day'],
];

const field = 'rounded border border-gray-600 bg-gray-900/60 px-2 py-1 text-sm text-gray-100';
const input = `w-full ${field}`;

type Limit = AdminIndexer['pacing'];

function LimitField({ label, name, limit }: { label: string; name: string; limit: Limit }) {
	// A window the presets lack (set over the API) stays selectable rather than lost on save.
	const windows =
		!limit || WINDOWS.some(([seconds]) => seconds === limit.windowSeconds)
			? WINDOWS
			: [...WINDOWS, [limit.windowSeconds, `${limit.windowSeconds} s`] as [number, string]];
	return (
		<label className="flex flex-col gap-1 text-xs text-gray-400">
			{label}
			<span className="flex items-center gap-2">
				<input
					name={`${name}Rate`}
					type="number"
					min={1}
					defaultValue={limit?.rateLimit ?? ''}
					placeholder="no limit"
					className={`${field} w-0 min-w-0 flex-1`}
				/>
				<span className="shrink-0 text-gray-400">per</span>
				<select
					name={`${name}Window`}
					defaultValue={limit?.windowSeconds ?? 3600}
					className={`${field} shrink-0`}
				>
					{windows.map(([seconds, text]) => (
						<option key={seconds} value={seconds}>
							{text}
						</option>
					))}
				</select>
			</span>
		</label>
	);
}

/** The form's fields as an API body; an empty key field keeps the stored key. */
function bodyFrom(form: HTMLFormElement) {
	const data = new FormData(form);
	const text = (name: string) => data.get(name)?.toString().trim() ?? '';
	const limit = (name: string) => {
		const rate = Number(text(`${name}Rate`));
		return rate > 0 ? { rateLimit: rate, windowSeconds: Number(text(`${name}Window`)) } : null;
	};
	return {
		prefix: text('prefix'),
		name: text('name'),
		url: text('url'),
		apiKey: text('apiKey'),
		keyless: data.get('keyless') === 'on',
		enabled: data.get('enabled') === 'on',
		position: Number(text('position')) || 0,
		pacing: limit('pacing'),
		grabLimit: limit('grabLimit'),
	};
}

function IndexerForm({
	indexer,
	onSave,
}: {
	/** Absent for the add form. */
	indexer?: AdminIndexer;
	onSave: (method: 'POST' | 'PATCH', body: ReturnType<typeof bodyFrom>) => Promise<boolean>;
}) {
	const [busy, setBusy] = useState(false);
	const submit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const form = event.currentTarget;
		setBusy(true);
		try {
			const saved = await onSave(indexer ? 'PATCH' : 'POST', bodyFrom(form));
			if (saved && !indexer) form.reset();
		} finally {
			setBusy(false);
		}
	};

	return (
		<form
			onSubmit={submit}
			className={`rounded border-2 p-4 text-sm text-gray-200 ${
				indexer && !indexer.enabled
					? 'border-gray-700 bg-gray-800/10 opacity-70'
					: 'border-gray-600 bg-gray-800/30'
			}`}
		>
			<div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
				<h2 className="text-base font-semibold text-gray-100">
					{indexer ? indexer.name : 'Add an indexer'}
				</h2>
				{indexer ? (
					<span className="font-mono text-xs text-gray-400">prefix {indexer.prefix}</span>
				) : null}
			</div>
			<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
				{indexer ? (
					<input type="hidden" name="prefix" value={indexer.prefix} />
				) : (
					<label className="flex flex-col gap-1 text-xs text-gray-400">
						Prefix (permanent: it is part of every release id)
						<input
							name="prefix"
							required
							pattern="[a-z0-9]{1,16}"
							placeholder="e.g. ng"
							className={input}
						/>
					</label>
				)}
				<label className="flex flex-col gap-1 text-xs text-gray-400">
					Name
					<input
						name="name"
						required
						maxLength={100}
						defaultValue={indexer?.name}
						className={input}
					/>
				</label>
				<label className="flex flex-col gap-1 text-xs text-gray-400 sm:col-span-2">
					API URL
					<input
						name="url"
						type="url"
						required
						defaultValue={indexer?.url}
						placeholder="https://example.com/api"
						className={input}
					/>
				</label>
				<label className="flex flex-col gap-1 text-xs text-gray-400">
					API key
					<input
						name="apiKey"
						type="password"
						autoComplete="off"
						placeholder={
							indexer?.keyHint
								? `Saved (${indexer.keyHint}); type to replace`
								: 'API key'
						}
						className={input}
					/>
				</label>
				<label className="flex flex-col gap-1 text-xs text-gray-400">
					Order (lowest is asked first)
					<input
						name="position"
						type="number"
						min={0}
						defaultValue={indexer?.position ?? 0}
						className={input}
					/>
				</label>
				<LimitField label="Searches" name="pacing" limit={indexer?.pacing ?? null} />
				<LimitField
					label="NZB downloads, all sponsors together"
					name="grabLimit"
					limit={indexer?.grabLimit ?? null}
				/>
			</div>
			<div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
				<label className="flex items-center gap-2">
					<input
						name="enabled"
						type="checkbox"
						defaultChecked={indexer?.enabled ?? true}
					/>
					Enabled
				</label>
				<label className="flex items-center gap-2">
					<input name="keyless" type="checkbox" defaultChecked={indexer?.keyless} />
					Searches without a key
				</label>
				<button
					disabled={busy}
					className="ml-auto rounded bg-cyan-700 px-3 py-1 text-sm font-semibold text-white hover:bg-cyan-600 disabled:opacity-50"
				>
					{indexer ? 'Save' : 'Add'}
				</button>
			</div>
		</form>
	);
}

function NewznabIndexers({ adminFetch }: { adminFetch: AdminFetch }) {
	const [indexers, setIndexers] = useState<AdminIndexer[] | null>(null);
	const [source, setSource] = useState<'database' | 'environment' | null>(null);
	const [message, setMessage] = useState<string | null>(null);

	const load = useCallback(async () => {
		const res = await adminFetch('/api/newznab/admin');
		if (!res.ok) {
			setIndexers(null);
			if (res.status !== 401) setMessage(`Loading failed (${res.status}).`);
			return;
		}
		const body = await res.json();
		setSource(body.source);
		setIndexers(body.indexers);
	}, [adminFetch]);

	useEffect(() => {
		void load();
	}, [load]);

	const onSave = async (method: 'POST' | 'PATCH', body: ReturnType<typeof bodyFrom>) => {
		const res = await adminFetch('/api/newznab/admin', {
			method,
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		});
		const reply = await res.json().catch(() => ({}));
		if (!res.ok) {
			setMessage(reply.error ?? `Saving failed (${res.status}).`);
			return false;
		}
		setMessage(
			`${reply.indexer.name} saved. Other DMM instances pick it up within 30 seconds.`
		);
		await load();
		return true;
	};

	return (
		<>
			{message ? <p className="text-sm text-yellow-300">{message}</p> : null}
			{source === 'environment' && indexers ? (
				<div className="rounded border border-yellow-600 bg-yellow-900/20 p-3 text-sm text-yellow-200">
					<p>
						No indexers are saved here yet, so searches use the{' '}
						<code>NEWZNAB_INDEXERS</code> setting, listed below read-only.
					</p>
					<p className="mt-1">
						Adding one here replaces that whole list. Import the {indexers.length}{' '}
						first, or only the new one will be searched.
					</p>
				</div>
			) : null}
			{source === 'environment'
				? indexers?.map((indexer) => (
						<section
							key={indexer.prefix}
							className="rounded border border-gray-700 p-3 text-sm text-gray-300"
						>
							<span className="font-semibold text-gray-100">{indexer.name}</span>{' '}
							<span className="font-mono text-xs break-all text-gray-400">
								{indexer.prefix} · {indexer.url}
							</span>
						</section>
					))
				: indexers?.map((indexer) => (
						<IndexerForm
							key={`${indexer.prefix}:${JSON.stringify(indexer)}`}
							indexer={indexer}
							onSave={onSave}
						/>
					))}
			{indexers ? <IndexerForm onSave={onSave} /> : null}
		</>
	);
}

export default function NewznabAdminPage() {
	return (
		<AdminLayout title="Newznab indexers">
			{(adminFetch) => <NewznabIndexers adminFetch={adminFetch} />}
		</AdminLayout>
	);
}
