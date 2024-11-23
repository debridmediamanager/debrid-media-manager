import { TraktSearchResult, getSearchSuggestions } from '@/services/trakt';
import getConfig from 'next/config';
import { useRouter } from 'next/router';
import { useEffect, useRef, useState } from 'react';
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
						className="mr-3 w-full appearance-none border-none bg-transparent px-2 py-1 text-lg leading-tight text-white focus:outline-none"
						type="text"
						placeholder={placeholder}
						value={typedQuery}
						onChange={(e) => setTypedQuery(e.target.value)}
						onFocus={() => setShowSuggestions(true)}
					/>
					<button
						type="submit"
						className="haptic-sm flex-shrink-0 rounded-lg border-2 border-gray-500 bg-gray-800/30 px-4 py-2 text-sm font-medium text-gray-100 transition-all hover:bg-gray-700/50"
					>
						Search
					</button>
				</div>
			</form>

			{showSuggestions && suggestions.length > 0 && (
				<div
					ref={suggestionsRef}
					className="absolute z-50 mt-2 w-full divide-y divide-gray-700/50 overflow-hidden rounded-xl border border-gray-700 bg-gray-800/95 shadow-2xl backdrop-blur-sm"
				>
					{suggestions.map((suggestion, index) => {
						const media = suggestion.movie || suggestion.show;
						if (!media) return null;
						return (
							<div
								key={`${media.ids?.trakt}-${index}`}
								className="group relative h-[64px] cursor-pointer overflow-hidden transition-all duration-300 ease-in-out"
								onClick={() => handleSuggestionClick(suggestion)}
							>
								{/* Content */}
								<div className="relative z-20 flex h-full items-center">
									<div className="flex w-[calc(100%-42px)] items-center justify-between px-3">
										<div className="flex max-w-[70%] items-center space-x-2">
											<span className="line-clamp-1 text-base font-medium text-white transition-colors group-hover:text-blue-400">
												{media.title}
											</span>
											<span className="whitespace-nowrap text-sm text-gray-400">
												({media.year})
											</span>
										</div>
										<span className="whitespace-nowrap rounded-full bg-gray-900/80 px-2 py-0.5 text-xs text-gray-400">
											{suggestion.type.charAt(0).toUpperCase() +
												suggestion.type.slice(1)}
										</span>
									</div>

									{/* Right-side poster (full view) */}
									<div className="absolute right-0 top-0 z-30 aspect-[2/3] h-full">
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
