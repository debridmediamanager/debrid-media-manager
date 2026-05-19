import { TraktSearchResult } from '@/services/trakt';
import axios from 'axios';
import { Film, Loader2, Search, Tv, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import Poster from './poster';

interface CastSearchModalProps {
	isOpen: boolean;
	onClose: () => void;
	torrentInfo: {
		title: string;
		filename: string;
		hash: string;
		files: Array<{ path: string; bytes: number }>;
	};
	onSelectImdbId: (imdbId: string) => void;
}

function useDebounce<T>(value: T, delay: number): T {
	const [debouncedValue, setDebouncedValue] = useState<T>(value);

	useEffect(() => {
		const handler = setTimeout(() => {
			setDebouncedValue(value);
		}, delay);

		return () => {
			clearTimeout(handler);
		};
	}, [value, delay]);

	return debouncedValue;
}

export function CastSearchModal({
	isOpen,
	onClose,
	torrentInfo,
	onSelectImdbId,
}: CastSearchModalProps) {
	const [searchQuery, setSearchQuery] = useState('');
	const [suggestions, setSuggestions] = useState<TraktSearchResult[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const debouncedQuery = useDebounce(searchQuery, 300);

	// Initialize search query with torrent title
	useEffect(() => {
		if (isOpen && !searchQuery) {
			// Clean up the title for search
			const cleanTitle = torrentInfo.title
				.replace(/\.(mkv|mp4|avi|mov)$/i, '')
				.replace(/\d{3,4}p/gi, '')
				.replace(/\b(BluRay|WEB-DL|WEBRip|HDTV|x264|x265|HEVC)\b/gi, '')
				.trim();
			setSearchQuery(cleanTitle);
		}
	}, [isOpen, torrentInfo.title, searchQuery]);

	useEffect(() => {
		const fetchSuggestions = async () => {
			if (debouncedQuery.length < 2) {
				setSuggestions([]);
				return;
			}

			setIsLoading(true);
			try {
				const response = await axios.get<TraktSearchResult[]>(
					`/api/trakt/search?query=${encodeURIComponent(debouncedQuery)}&types=movie,show`
				);
				setSuggestions(response.data.slice(0, 10));
			} catch (error) {
				console.error('Error fetching suggestions:', error);
				setSuggestions([]);
			} finally {
				setIsLoading(false);
			}
		};

		fetchSuggestions();
	}, [debouncedQuery]);

	const handleSuggestionClick = (suggestion: TraktSearchResult) => {
		const media = suggestion.movie || suggestion.show;
		if (media?.ids?.imdb) {
			onSelectImdbId(media.ids.imdb);
		}
	};

	const directImdbMatch = searchQuery.match(/(tt\d{7,})/)?.[1];

	if (!isOpen) return null;

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
			<div className="relative w-full max-w-2xl rounded-lg bg-gray-900 p-6 shadow-xl">
				{/* Close button */}
				<button
					onClick={onClose}
					className="absolute right-4 top-4 text-gray-400 transition-colors hover:text-white"
					aria-label="Close"
				>
					<X className="h-6 w-6" />
				</button>

				{/* Header */}
				<h2 className="mb-4 text-2xl font-bold text-white">Cast to Stremio</h2>

				{/* Torrent Info */}
				<div className="mb-6 rounded-md bg-gray-800 p-4">
					<p className="mb-1 text-sm text-gray-400">Torrent:</p>
					<p className="mb-2 font-medium text-white">{torrentInfo.filename}</p>
					<p className="text-xs text-gray-500">
						{torrentInfo.files.length} file{torrentInfo.files.length !== 1 ? 's' : ''} •
						Hash: {torrentInfo.hash.substring(0, 8)}...
					</p>
				</div>

				{/* Search Input */}
				<div className="mb-4">
					<label className="mb-2 block text-sm font-medium text-gray-300">
						Search for the movie or show:
					</label>
					<div className="relative">
						<Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
						<input
							type="text"
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
							placeholder="Search by title or paste an IMDB ID (tt1234567)..."
							className="w-full rounded-md border border-gray-700 bg-gray-800 py-2 pl-10 pr-4 text-white placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
							autoFocus
						/>
					</div>
				</div>

				{/* Direct IMDB ID */}
				{directImdbMatch && (
					<button
						onClick={() => onSelectImdbId(directImdbMatch)}
						className="mb-4 flex w-full items-center gap-3 rounded-md border border-blue-500 bg-blue-900/30 p-3 text-left transition-colors hover:bg-blue-800/50"
					>
						<Film className="h-5 w-5 text-blue-400" />
						<div>
							<p className="font-semibold text-white">
								Use IMDB ID: {directImdbMatch}
							</p>
							<p className="text-xs text-gray-400">
								Cast using this IMDB ID directly
							</p>
						</div>
					</button>
				)}

				{/* Loading State */}
				{isLoading && (
					<div className="flex items-center justify-center py-8">
						<Loader2 className="h-8 w-8 animate-spin text-blue-500" />
					</div>
				)}

				{/* Results */}
				{!isLoading && suggestions.length > 0 && (
					<div className="max-h-96 space-y-2 overflow-y-auto">
						{suggestions.map((suggestion, index) => {
							const media = suggestion.movie || suggestion.show;
							if (!media?.ids?.imdb) return null;

							return (
								<button
									key={index}
									onClick={() => handleSuggestionClick(suggestion)}
									className="flex w-full items-center gap-4 rounded-md bg-gray-800 p-3 text-left transition-colors hover:bg-gray-700"
								>
									{/* Poster */}
									<div className="h-20 w-14 flex-shrink-0 overflow-hidden rounded">
										<Poster imdbId={media.ids.imdb} title={media.title} />
									</div>

									{/* Info */}
									<div className="flex-1">
										<div className="flex items-center gap-2">
											{suggestion.type === 'movie' ? (
												<Film className="h-4 w-4 text-yellow-500" />
											) : (
												<Tv className="h-4 w-4 text-cyan-500" />
											)}
											<h3 className="font-semibold text-white">
												{media.title}
											</h3>
										</div>
										<p className="text-sm text-gray-400">
											{media.year} •{' '}
											{suggestion.type === 'movie' ? 'Movie' : 'TV Show'}
										</p>
										{media.ids.imdb && (
											<p className="text-xs text-gray-500">
												{media.ids.imdb}
											</p>
										)}
									</div>
								</button>
							);
						})}
					</div>
				)}

				{/* No Results */}
				{!isLoading && debouncedQuery.length >= 2 && suggestions.length === 0 && (
					<div className="py-8 text-center text-gray-400">
						No results found. Try a different search term.
					</div>
				)}

				{/* Help Text */}
				{!isLoading && debouncedQuery.length < 2 && (
					<div className="py-8 text-center text-sm text-gray-400">
						Type at least 2 characters to search
					</div>
				)}
			</div>
		</div>
	);
}
