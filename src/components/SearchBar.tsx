import type { AnimeSearchResult } from '@/services/database/anime';
import { TraktSearchResult } from '@/services/trakt';
import { animePagePath } from '@/utils/anidbId';
import { fetchAnimeSuggestions } from '@/utils/animeSuggestions';
import axios from 'axios';
import { useRouter } from 'next/router';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { animeTypeLabel } from './AnimeEntryLinks';
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

interface SuggestionRowProps {
	title: string;
	year?: number | null;
	badge: string;
	badgeClassName?: string;
	poster: ReactNode;
	onSelect: () => void;
}

function SuggestionRow({
	title,
	year,
	badge,
	badgeClassName = 'text-gray-400',
	poster,
	onSelect,
}: SuggestionRowProps) {
	return (
		<div
			className="group relative h-[64px] cursor-pointer overflow-hidden transition-all duration-300 ease-in-out"
			onClick={onSelect}
		>
			{/* Content */}
			<div className="relative z-20 flex h-full items-center">
				<div className="flex w-[calc(100%-42px)] items-center justify-between px-3">
					<div className="flex max-w-[70%] items-center space-x-2">
						<span
							className="line-clamp-1 text-base font-medium text-white transition-colors group-hover:text-blue-400"
							title={title}
						>
							{title}
						</span>
						{year != null && (
							<span className="whitespace-nowrap text-sm text-gray-400">
								({year})
							</span>
						)}
					</div>
					{badge && (
						<span
							className={`whitespace-nowrap rounded-full bg-gray-900/80 px-2 py-0.5 text-xs ${badgeClassName}`}
						>
							{badge}
						</span>
					)}
				</div>

				{/* Right-side poster (full view) */}
				<div className="absolute right-0 top-0 z-30 aspect-[2/3] h-full">{poster}</div>
			</div>
		</div>
	);
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
	const [typedQuery, setTypedQuery] = useState('');
	const [suggestions, setSuggestions] = useState<TraktSearchResult[]>([]);
	const [animeSuggestions, setAnimeSuggestions] = useState<AnimeSearchResult[]>([]);
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

	// Trakt and anime search are asked side by side, and each fills its own part
	// of the dropdown when it answers: a slow or failed one never holds back the
	// other. An answer for a query that has since changed is dropped.
	useEffect(() => {
		if (debouncedQuery.length < 2) {
			setSuggestions([]);
			setAnimeSuggestions([]);
			return;
		}
		let current = true;

		axios
			.get<TraktSearchResult[]>(
				`/api/trakt/search?query=${encodeURIComponent(debouncedQuery)}&types=movie,show`
			)
			.then((response) => {
				if (!current) return;
				setSuggestions(Array.isArray(response.data) ? response.data.slice(0, 6) : []);
				setShowSuggestions(true);
			})
			.catch((error) => {
				console.error('Error fetching suggestions:', error);
				if (current) setSuggestions([]);
			});

		fetchAnimeSuggestions(debouncedQuery)
			.then((rows) => {
				if (!current) return;
				setAnimeSuggestions(rows);
				if (rows.length > 0) setShowSuggestions(true);
			})
			.catch((error) => {
				console.error('Error fetching anime suggestions:', error);
				if (current) setAnimeSuggestions([]);
			});

		return () => {
			current = false;
		};
	}, [debouncedQuery]);

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

	const handleAnimeClick = (path: string) => {
		setShowSuggestions(false);
		router.push(path);
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

			{showSuggestions && (suggestions.length > 0 || animeSuggestions.length > 0) && (
				<div
					ref={suggestionsRef}
					className="absolute z-50 mt-2 w-full divide-y divide-gray-700/50 overflow-hidden rounded-xl border border-gray-700 bg-gray-800/95 shadow-2xl backdrop-blur-sm"
				>
					{suggestions.map((suggestion, index) => {
						const media = suggestion.movie || suggestion.show;
						if (!media) return null;
						return (
							<SuggestionRow
								key={`${media.ids?.trakt}-${index}`}
								title={media.title}
								year={media.year}
								badge={
									suggestion.type.charAt(0).toUpperCase() +
									suggestion.type.slice(1)
								}
								onSelect={() => handleSuggestionClick(suggestion)}
								poster={
									media.ids?.imdb && (
										<div className="h-full w-full">
											<Poster imdbId={media.ids.imdb} title={media.title} />
										</div>
									)
								}
							/>
						);
					})}
					{/* AniDB entries. A season, OVA or donghua with no IMDb id has no
					    Trakt row above, so this is the dropdown's only way to it. */}
					{animeSuggestions.length > 0 && (
						<div
							role="group"
							aria-label="Anime"
							data-testid="anime-suggestions"
							className="divide-y divide-gray-700/50"
						>
							<div className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-fuchsia-300">
								Anime
							</div>
							{animeSuggestions.map((result) => {
								const path = animePagePath(result.id)!;
								return (
									<SuggestionRow
										key={result.id}
										title={result.title}
										badge={animeTypeLabel(result.type)}
										badgeClassName="text-fuchsia-300"
										onSelect={() => handleAnimeClick(path)}
										poster={
											result.poster_url && (
												// eslint-disable-next-line @next/next/no-img-element
												<img
													src={result.poster_url}
													alt={`${result.title} poster`}
													loading="lazy"
													className="h-full w-full object-cover"
													// A third of the old Kitsu posters are gone from
													// both of Kitsu's hosts; leave the space empty.
													onError={(e) => {
														e.currentTarget.style.visibility = 'hidden';
													}}
												/>
											)
										}
									/>
								);
							})}
						</div>
					)}
				</div>
			)}
		</div>
	);
}
