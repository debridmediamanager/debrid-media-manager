import { sponsorHeaders, useSponsor } from '@/hooks/useSponsor';
import {
	LIVE_SERVICE_KEY_SOURCES,
	LIVE_SERVICE_LABELS,
	TORZNAB_LIVE_SERVICES,
	type TorznabLiveService,
} from '@/utils/sponsorProviders';
import { Filter, Trash2 } from 'lucide-react';
import { FC, FormEvent, useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';

interface LinkedProvider {
	service: TorznabLiveService;
	label: string;
	hint: string;
	updatedAt: string;
}

/**
 * Where a sponsor links the debrid key that a provider-backed Torznab feed
 * needs.
 *
 * Lives on `/torznab`, inside the card that explains the feeds, rather than in
 * Settings where it started. Reading "only what TorBox already holds" and then
 * being sent to another page to make it work was one context switch too many,
 * and the form has no meaning away from that explanation.
 *
 * Real-Debrid and AllDebrid are not offered, and their absence is the point:
 * `/api/torznab/rd/cached` is answered from DMM's own tables, so it already
 * works for every sponsor and asking for an RD key would imply otherwise. Only
 * the providers DMM cannot answer for by itself appear.
 *
 * Shown to everyone. A non-sponsor sees exactly what the feature is and what
 * would open it, rather than a panel that is simply not there.
 */
export const TorznabProviderPanel: FC = () => {
	const { isSponsor, token } = useSponsor();
	const [linked, setLinked] = useState<LinkedProvider[]>([]);
	const [drafts, setDrafts] = useState<Partial<Record<TorznabLiveService, string>>>({});
	const [busy, setBusy] = useState<TorznabLiveService | null>(null);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		if (!token) return;
		try {
			const res = await fetch('/api/sponsor/provider-key', { headers: sponsorHeaders() });
			if (!res.ok) return;
			const data = await res.json();
			setLinked(Array.isArray(data.linked) ? data.linked : []);
		} catch {
			// A panel that cannot list is still a panel that can link.
		}
	}, [token]);

	useEffect(() => {
		load();
	}, [load]);

	const submit = async (service: TorznabLiveService, event: FormEvent) => {
		event.preventDefault();
		const apiKey = (drafts[service] ?? '').trim();
		if (!apiKey || busy) return;

		setBusy(service);
		setError(null);
		try {
			const res = await fetch('/api/sponsor/provider-key', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', ...sponsorHeaders() },
				body: JSON.stringify({ service, apiKey }),
			});
			const data = await res.json();
			if (!res.ok) {
				setError(data.error ?? 'Could not verify that key');
				return;
			}
			setLinked(data.linked ?? []);
			setDrafts((current) => ({ ...current, [service]: '' }));
			toast.success(`${LIVE_SERVICE_LABELS[service]} linked`, { icon: '🔗' });
		} catch {
			setError('Could not reach the server');
		} finally {
			setBusy(null);
		}
	};

	const unlink = async (service: TorznabLiveService) => {
		setBusy(service);
		setError(null);
		try {
			const res = await fetch('/api/sponsor/provider-key', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json', ...sponsorHeaders() },
				body: JSON.stringify({ service }),
			});
			const data = await res.json();
			if (res.ok) {
				setLinked(data.linked ?? []);
				toast(`${LIVE_SERVICE_LABELS[service]} unlinked.`);
			}
		} catch {
			setError('Could not reach the server');
		} finally {
			setBusy(null);
		}
	};

	return (
		<div className="rounded border-2 border-cyan-500/30 p-4">
			<div className="mb-1 flex items-center justify-center gap-2 text-center text-sm font-medium text-cyan-200">
				<Filter className="h-4 w-4 text-cyan-400" />
				Link a provider key
			</div>
			<p className="mb-3 text-center text-xs text-gray-400">
				Only the three that have to be asked. Each key is checked against that provider
				before it is stored, so a typo is refused here rather than turning into an empty
				feed a week from now.
			</p>

			{error && <p className="mb-2 text-center text-xs text-red-300">{error}</p>}

			<div className="flex flex-col gap-3">
				{TORZNAB_LIVE_SERVICES.map((service) => {
					const existing = linked.find((row) => row.service === service);
					return (
						<div
							key={service}
							className="rounded border border-gray-600 bg-gray-900/40 p-3"
						>
							<div className="mb-2 flex items-center justify-between gap-2">
								<span className="text-sm font-medium text-gray-100">
									{LIVE_SERVICE_LABELS[service]}
								</span>
								<code className="rounded bg-gray-800 px-2 py-0.5 font-mono text-xs text-cyan-300">
									/api/torznab/{service}/cached
								</code>
							</div>

							{existing ? (
								<div className="flex items-center justify-between gap-2">
									<span className="font-mono text-xs text-gray-300">
										{existing.hint}
									</span>
									<button
										type="button"
										onClick={() => unlink(service)}
										disabled={busy === service}
										className="inline-flex items-center gap-1 rounded border border-gray-600 px-2 py-1 text-xs text-gray-300 hover:bg-gray-700/50 disabled:opacity-50"
									>
										<Trash2 className="h-3 w-3" />
										Unlink
									</button>
								</div>
							) : (
								<form
									onSubmit={(event) => submit(service, event)}
									className="flex flex-col gap-2"
								>
									<input
										type="text"
										aria-label={`${LIVE_SERVICE_LABELS[service]} API key`}
										value={drafts[service] ?? ''}
										onChange={(e) => {
											const value = e.target.value;
											setDrafts((current) => ({
												...current,
												[service]: value,
											}));
											setError(null);
										}}
										placeholder={`${LIVE_SERVICE_LABELS[service]} API key`}
										autoComplete="off"
										spellCheck={false}
										disabled={!isSponsor}
										className="rounded border border-gray-600 bg-gray-900 px-3 py-2 font-mono text-xs text-gray-100 placeholder:text-gray-500 focus:border-cyan-400 focus:outline-none disabled:opacity-50"
									/>
									<div className="flex items-center justify-between gap-2">
										<span className="text-xs text-gray-500">
											{LIVE_SERVICE_KEY_SOURCES[service]}
										</span>
										<button
											type="submit"
											disabled={
												!isSponsor ||
												busy === service ||
												!(drafts[service] ?? '').trim()
											}
											className="rounded bg-cyan-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-600 disabled:opacity-50"
										>
											{busy === service ? 'Checking…' : 'Link'}
										</button>
									</div>
								</form>
							)}
						</div>
					);
				})}
			</div>

			{!isSponsor && (
				<p className="mt-3 text-center text-xs text-gray-400">
					Linking a key is a sponsor feature.
				</p>
			)}
		</div>
	);
};

export default TorznabProviderPanel;
