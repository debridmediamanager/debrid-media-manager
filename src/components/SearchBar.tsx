import getConfig from 'next/config';
import { useRouter } from 'next/router';
import { useEffect, useRef, useState } from 'react';
import { TraktSearchResult, getSearchSuggestions } from '../services/trakt';

// Custom debounce hook
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

interface SearchBarProps {
	className?: string;
	placeholder?: string;
}

export function SearchBar({
	className = '',
	placeholder = 'Search movies & shows...',
}: SearchBarProps) {
	const router = useRouter();
	const { publicRuntimeConfig: config } = getConfig();
	const [typedQuery, setTypedQuery] = useState('');
	const [suggestions, setSuggestions] = useState<TraktSearchResult[]>([]);
	const [showSuggestions, setShowSuggestions] = useState(false);
	const suggestionsRef = useRef<HTMLDivElement>(null);
	const debouncedQuery = useDebounce(typedQuery, 300);

	// Close suggestions when clicking outside
	useEffect(() => {
		function handleClickOutside(event: MouseEvent) {
			if (suggestionsRef.current && !suggestionsRef.current.contains(event.target as Node)) {
				setShowSuggestions(false);
			}
		}

		document.addEventListener('mousedown', handleClickOutside);
		return () => {
			document.removeEventListener('mousedown', handleClickOutside);
		};
	}, []);

	// Fetch suggestions when query changes
	useEffect(() => {
		const fetchSuggestions = async () => {
			if (debouncedQuery.length < 2) {
				setSuggestions([]);
				return;
			}

			try {
				const results = await getSearchSuggestions(
					debouncedQuery,
					['movie', 'show'],
					config.traktClientId
				);
				setSuggestions(results);
				setShowSuggestions(true);
			} catch (error) {
				console.error('Error fetching suggestions:', error);
			}
		};

		fetchSuggestions();
	}, [debouncedQuery, config.traktClientId]);

	const handleSuggestionClick = (suggestion: TraktSearchResult) => {
		const media = suggestion.movie || suggestion.show;
		if (media?.ids?.imdb) {
			setShowSuggestions(false);
			router.push(`/${suggestion.type}/${media.ids.imdb}`);
		} else {
			setTypedQuery(media?.title || '');
			router.push(`/search?query=${encodeURIComponent(media?.title || '')}`);
		}
	};

	const handleSearch = (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		if (!typedQuery) return;
		setShowSuggestions(false);
		if (/(tt\d{7,})/.test(typedQuery)) {
			const imdbid = typedQuery.match(/(tt\d{7,})/)?.[1];
			router.push(`/x/${imdbid}/`);
			return;
		}
		router.push(`/search?query=${encodeURIComponent(typedQuery)}`);
	};

	return (
		<div className={`relative ${className}`}>
			<form onSubmit={handleSearch}>
				<div className="flex items-center border-b-2 border-gray-500 py-2">
					<input
						className="appearance-none bg-transparent border-none w-full text-white mr-3 py-1 px-2 leading-tight focus:outline-none"
						type="text"
						placeholder={placeholder}
						value={typedQuery}
						onChange={(e) => setTypedQuery(e.target.value)}
						onFocus={() => setShowSuggestions(true)}
					/>
					<button
						type="submit"
						className="flex-shrink-0 px-4 py-2 rounded border-2 border-gray-500 bg-gray-800/30 text-gray-100 hover:bg-gray-700/50 transition-colors text-sm font-medium haptic-sm"
					>
						Search
					</button>
				</div>
			</form>

			{/* Suggestions dropdown */}
			{showSuggestions && suggestions.length > 0 && (
				<div
					ref={suggestionsRef}
					className="absolute z-50 w-full bg-gray-800 border border-gray-700 rounded-md shadow-lg mt-1"
				>
					{suggestions.map((suggestion, index) => {
						const media = suggestion.movie || suggestion.show;
						if (!media) return null;
						return (
							<div
								key={`${media.ids?.trakt}-${index}`}
								className="p-2 hover:bg-gray-700 cursor-pointer flex items-center text-white"
								onClick={() => handleSuggestionClick(suggestion)}
							>
								<div className="flex-1">
									<div className="font-medium">{media.title}</div>
									<div className="text-sm text-gray-400">
										{suggestion.type} • {media.year}
									</div>
								</div>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
