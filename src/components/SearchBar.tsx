import getConfig from 'next/config';
import { useRouter } from 'next/router';
import { useEffect, useRef, useState } from 'react';
import { TraktSearchResult, getSearchSuggestions } from '../services/trakt';
import Poster from './poster';

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
				setSuggestions(results.slice(0, 6));
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
						className="appearance-none bg-transparent border-none w-full text-white mr-3 py-1 px-2 leading-tight focus:outline-none text-lg"
						type="text"
						placeholder={placeholder}
						value={typedQuery}
						onChange={(e) => setTypedQuery(e.target.value)}
						onFocus={() => setShowSuggestions(true)}
					/>
					<button
						type="submit"
						className="flex-shrink-0 px-4 py-2 rounded-lg border-2 border-gray-500 bg-gray-800/30 text-gray-100 hover:bg-gray-700/50 transition-all text-sm font-medium haptic-sm"
					>
						Search
					</button>
				</div>
			</form>

			{showSuggestions && suggestions.length > 0 && (
				<div
					ref={suggestionsRef}
					className="absolute z-50 w-full bg-gray-800/95 backdrop-blur-sm border border-gray-700 rounded-xl shadow-2xl mt-2 overflow-hidden divide-y divide-gray-700/50"
				>
					{suggestions.map((suggestion, index) => {
						const media = suggestion.movie || suggestion.show;
						if (!media) return null;
						return (
							<div
								key={`${media.ids?.trakt}-${index}`}
								className="relative h-[64px] cursor-pointer group overflow-hidden transition-all duration-300 ease-in-out"
								onClick={() => handleSuggestionClick(suggestion)}
							>
								{/* Content */}
								<div className="relative z-20 h-full flex items-center">
									<div className="flex items-center justify-between w-[calc(100%-42px)] px-3">
										<div className="flex items-center space-x-2 max-w-[70%]">
											<span className="font-medium text-base text-white group-hover:text-blue-400 transition-colors line-clamp-1">
												{media.title}
											</span>
											<span className="text-sm text-gray-400 whitespace-nowrap">
												({media.year})
											</span>
										</div>
										<span className="text-xs text-gray-400 bg-gray-900/80 px-2 py-0.5 rounded-full whitespace-nowrap">
											{suggestion.type.charAt(0).toUpperCase() +
												suggestion.type.slice(1)}
										</span>
									</div>

									{/* Right-side poster (full view) */}
									<div className="absolute right-0 top-0 h-full aspect-[2/3] z-30">
										{media.ids?.imdb && (
											<div className="h-full w-full">
												<Poster
													imdbId={media.ids.imdb}
													title={media.title}
												/>
											</div>
										)}
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
