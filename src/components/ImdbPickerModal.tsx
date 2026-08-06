import { TraktSearchResult } from '@/services/trakt';
import axios from 'axios';
import { Loader2, Search as SearchIcon, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import Poster from './poster';

export interface ImdbPick {
	imdbId: string;
	mediaType: 'movie' | 'tv';
	title: string;
	year?: number;
}

interface ImdbPickerModalProps {
	open: boolean;
	// Prefilled search text — usually the torrent's parsed title, so the right
	// result is often the first suggestion.
	initialQuery?: string;
	// A short line naming what the imdb id is being chosen for (e.g. the filename).
	subtitle?: string;
	onPick: (pick: ImdbPick) => void;
	onClose: () => void;
}

function useDebounce<T>(value: T, delay: number): T {
	const [debounced, setDebounced] = useState<T>(value);
	useEffect(() => {
		const t = setTimeout(() => setDebounced(value), delay);
		return () => clearTimeout(t);
	}, [value, delay]);
	return debounced;
}

// Lets the user attach an imdb id to a library torrent (which carries none) by
// searching the same trakt catalog the index page uses. Reused by any flow that
// needs "pick a title" — the library Send-to-RD action being the first.
export default function ImdbPickerModal({
	open,
	initialQuery = '',
	subtitle,
	onPick,
	onClose,
}: ImdbPickerModalProps) {
	const [query, setQuery] = useState(initialQuery);
	const [suggestions, setSuggestions] = useState<TraktSearchResult[]>([]);
	const [loading, setLoading] = useState(false);
	const debounced = useDebounce(query.trim(), 300);
	const inputRef = useRef<HTMLInputElement>(null);

	// Reset to the passed-in query each time the modal opens for a new torrent.
	useEffect(() => {
		if (open) {
			setQuery(initialQuery);
			setSuggestions([]);
			setTimeout(() => inputRef.current?.focus(), 50);
		}
	}, [open, initialQuery]);

	useEffect(() => {
		if (!open) return;
		// A pasted imdb id needs no lookup.
		if (/^tt\d+$/.test(debounced)) {
			setSuggestions([]);
			setLoading(false);
			return;
		}
		if (debounced.length < 2) {
			setSuggestions([]);
			return;
		}
		let cancelled = false;
		setLoading(true);
		axios
			.get<TraktSearchResult[]>(
				`/api/trakt/search?query=${encodeURIComponent(debounced)}&types=movie,show`
			)
			.then((res) => {
				if (!cancelled) setSuggestions(res.data.slice(0, 8));
			})
			.catch(() => {
				if (!cancelled) setSuggestions([]);
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [debounced, open]);

	if (!open) return null;

	const pasteMatch = query.trim().match(/^(tt\d+)$/);

	const pickFromSuggestion = (s: TraktSearchResult) => {
		const media = s.movie || s.show;
		if (!media?.ids?.imdb) return;
		onPick({
			imdbId: media.ids.imdb,
			mediaType: s.type === 'show' ? 'tv' : 'movie',
			title: media.title,
			year: media.year,
		});
	};

	return (
		<div
			className="fixed inset-0 z-[60] flex items-start justify-center bg-black/70 p-4 pt-[10vh]"
			onClick={onClose}
		>
			<div
				className="w-full max-w-lg overflow-hidden rounded-xl border border-gray-700 bg-gray-900 shadow-2xl"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="flex items-start justify-between gap-2 border-b border-gray-700 p-3">
					<div className="min-w-0">
						<h2 className="text-sm font-bold text-white">Pick the title (IMDB)</h2>
						{subtitle && (
							<p className="mt-0.5 truncate text-xs text-gray-400">{subtitle}</p>
						)}
					</div>
					<button
						onClick={onClose}
						className="haptic-sm rounded p-1 text-gray-400 hover:text-gray-200"
						aria-label="Close"
					>
						<X className="h-4 w-4" />
					</button>
				</div>

				<div className="p-3">
					<div className="flex items-center rounded-lg border-2 border-gray-600 bg-gray-800/50 px-2">
						<SearchIcon className="h-4 w-4 shrink-0 text-gray-400" />
						<input
							ref={inputRef}
							className="w-full bg-transparent px-2 py-2 text-sm text-white focus:outline-none"
							placeholder="Search movies & shows, or paste a tt… id"
							value={query}
							onChange={(e) => setQuery(e.target.value)}
						/>
						{loading && (
							<Loader2 className="h-4 w-4 shrink-0 animate-spin text-gray-400" />
						)}
					</div>

					{pasteMatch && (
						<button
							onClick={() =>
								onPick({
									imdbId: pasteMatch[1],
									mediaType: 'movie',
									title: pasteMatch[1],
								})
							}
							className="mt-2 w-full rounded border-2 border-indigo-500 bg-indigo-900/30 px-2 py-2 text-left text-xs text-indigo-100 hover:bg-indigo-800/50"
						>
							Use IMDB id <span className="font-mono">{pasteMatch[1]}</span> (as
							movie)
						</button>
					)}

					<div className="mt-2 max-h-[45vh] divide-y divide-gray-700/50 overflow-y-auto">
						{suggestions.map((s, i) => {
							const media = s.movie || s.show;
							if (!media?.ids?.imdb) return null;
							return (
								<div
									key={`${media.ids.trakt}-${i}`}
									className="group flex cursor-pointer items-center gap-3 py-2 pr-2 hover:bg-gray-800/60"
									onClick={() => pickFromSuggestion(s)}
								>
									<div className="aspect-[2/3] h-14 shrink-0 overflow-hidden rounded">
										<Poster imdbId={media.ids.imdb} title={media.title} />
									</div>
									<div className="min-w-0 flex-1">
										<div className="truncate text-sm font-medium text-white group-hover:text-blue-400">
											{media.title}{' '}
											{media.year && (
												<span className="text-gray-400">
													({media.year})
												</span>
											)}
										</div>
										<div className="text-xs text-gray-500">
											{s.type === 'show' ? 'TV' : 'Movie'} · {media.ids.imdb}
										</div>
									</div>
								</div>
							);
						})}
						{!loading &&
							!pasteMatch &&
							debounced.length >= 2 &&
							suggestions.length === 0 && (
								<div className="py-6 text-center text-xs text-gray-500">
									No matches — try a different title, or paste the tt… id.
								</div>
							)}
					</div>
				</div>
			</div>
		</div>
	);
}
