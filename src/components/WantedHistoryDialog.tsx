import { sponsorHeaders } from '@/hooks/useSponsor';
import type { WantedItemResponse } from '@/pages/api/wanted';
import type { WantedHistoryResponse } from '@/pages/api/wanted/history';
import {
	episodeCode,
	episodeRanges,
	KIND_WORDS,
	progressLabel,
	REASON_WORDS,
} from '@/utils/wantedProgress';
import { Loader2, X } from 'lucide-react';
import { useEffect, useState } from 'react';

const KIND_COLORS: Record<string, string> = {
	grabbed: 'border-green-600 bg-green-900/40 text-green-100',
	rejected: 'border-amber-600 bg-amber-900/40 text-amber-100',
	failed: 'border-gray-600 bg-gray-800 text-gray-200',
	removed: 'border-red-600 bg-red-900/40 text-red-100',
};

/** What zurg reported for one wanted title: a show's episodes held and missing, then its events. */
export default function WantedHistoryDialog({
	item,
	onClose,
}: {
	item: WantedItemResponse;
	onClose: () => void;
}) {
	const [history, setHistory] = useState<WantedHistoryResponse | null>(null);
	const [error, setError] = useState('');

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onClose();
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [onClose]);

	useEffect(() => {
		let gone = false;
		fetch(`/api/wanted/history?id=${encodeURIComponent(item.id)}`, {
			headers: sponsorHeaders(),
		})
			.then(async (res) => {
				const data = await res.json();
				if (!res.ok) throw new Error(data.error || res.statusText);
				if (!gone) setHistory(data);
			})
			.catch((e) => !gone && setError(e instanceof Error ? e.message : 'unreachable'));
		return () => {
			gone = true;
		};
	}, [item.id]);

	const summary = progressLabel(
		history?.seasons.map((s) => ({ ...s, have: s.have.length })) ?? item.progress
	);

	return (
		<div
			className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-2 backdrop-blur-sm"
			onClick={onClose}
			role="dialog"
			aria-modal="true"
			aria-labelledby="wanted-history-title"
		>
			<div
				className="relative flex max-h-[90vh] w-full max-w-2xl flex-col rounded border border-gray-700 bg-gray-900 shadow-2xl"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="flex items-start gap-2 border-b border-gray-700 p-3">
					<div className="min-w-0 flex-1">
						<h2
							id="wanted-history-title"
							className="text-sm font-bold break-words text-white"
						>
							{item.title}
						</h2>
						{summary && <p className="text-xs text-gray-400">{summary}</p>}
					</div>
					<button
						type="button"
						onClick={onClose}
						aria-label="Close history"
						className="haptic-sm shrink-0 rounded border-2 border-gray-600 bg-gray-800/40 p-1 text-gray-300 transition-colors hover:bg-gray-700/50"
					>
						<X className="h-4 w-4" />
					</button>
				</div>

				<div className="min-h-0 flex-1 overflow-y-auto p-3 text-xs text-gray-300">
					{error && (
						<p className="rounded border-2 border-red-600 bg-red-900/20 p-2 text-red-200">
							Could not load the history: {error}
						</p>
					)}
					{!history && !error && (
						<Loader2 className="mx-auto h-5 w-5 animate-spin text-gray-400" />
					)}
					{history && history.seasons.length > 0 && (
						<p className="mb-1 text-[11px] text-gray-500">
							Aired episodes zurg took, or found in your library as the release it
							searched for. An episode you added another way shows as missing until
							zurg takes one.
						</p>
					)}
					{history && history.seasons.length > 0 && (
						<ul className="mb-3 divide-y divide-gray-800 rounded border border-gray-700">
							{history.seasons.map((s) => (
								<li key={s.season}>
									<details>
										<summary className="flex cursor-pointer flex-wrap gap-x-2 px-2 py-1.5">
											<span className="font-medium text-gray-100">
												Season {s.season}
											</span>
											<span>
												{s.have.length}/{s.have.length + s.missing.length}
											</span>
											{s.missing.length > 0 && (
												<span className="text-rose-300">
													{s.missing.length === 1
														? `${episodeCode(s.season, s.missing[0])} missing`
														: `${s.missing.length.toLocaleString()} missing`}
												</span>
											)}
										</summary>
										<div className="space-y-1 px-2 pb-2 break-words">
											{s.missing.length > 0 && (
												<p>
													<span className="text-rose-300">Missing:</span>{' '}
													{episodeRanges(s.missing)}
												</p>
											)}
											{s.have.length > 0 && (
												<p>
													<span className="text-green-300">Have:</span>{' '}
													{episodeRanges(s.have)}
												</p>
											)}
										</div>
									</details>
								</li>
							))}
						</ul>
					)}
					{history?.events.length === 0 && (
						<p className="text-center text-gray-400">
							Your zurg has not reported anything for this title yet. It needs a zurg
							that sends its history.
						</p>
					)}
					{!!history?.events.length && (
						<ul className="divide-y divide-gray-800">
							{history.events.map((e, i) => (
								<li key={i} className="py-2">
									<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
										<span
											className={`rounded border px-1.5 py-0.5 text-[11px] ${KIND_COLORS[e.kind] ?? KIND_COLORS.failed}`}
										>
											{KIND_WORDS[e.kind] ?? e.kind}
										</span>
										<time dateTime={e.at} className="text-gray-400">
											{new Date(e.at).toLocaleString()}
										</time>
										{e.season !== undefined && (
											<span className="text-gray-400">
												{e.episode !== undefined && !e.pack
													? episodeCode(e.season, e.episode)
													: `Season ${e.season}`}
											</span>
										)}
										{e.release && (
											<span className="text-gray-400">
												{e.torrent ? 'Torrent' : 'NZB'}
												{e.resolution && ` · ${e.resolution}`}
											</span>
										)}
									</div>
									{e.release && (
										<p className="mt-1 font-mono text-[11px] break-all text-gray-100">
											{e.release}
										</p>
									)}
									{(e.reason || e.detail) && (
										<p className="mt-1 break-words">
											{e.reason && (
												<span className="text-gray-100">
													{REASON_WORDS[e.reason] ?? e.reason}
												</span>
											)}
											{e.reason && e.detail && ': '}
											{e.detail}
										</p>
									)}
								</li>
							))}
						</ul>
					)}
				</div>
			</div>
		</div>
	);
}
