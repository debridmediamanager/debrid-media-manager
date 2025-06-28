import Image from 'next/image';
import { useEffect, useState } from 'react';

// Function to get deterministic poster subdomain based on IMDB ID
const getPosterUrl = (imdbId: string | null | undefined): string => {
	// Return empty string if no valid imdbId
	if (!imdbId) return '';

	// Extract numeric part from IMDB ID (e.g., "tt1234567" -> "1234567")
	const numericId = imdbId.replace(/[^0-9]/g, '');

	// Simple hash function for good distribution
	let hash = 0;
	for (let i = 0; i < numericId.length; i++) {
		hash = (hash << 5) - hash + parseInt(numericId[i]);
		hash = hash & hash; // Convert to 32bit integer
	}

	// Ensure positive number and get value 0-9
	const subdomain = Math.abs(hash) % 10;
	return `https://posters${subdomain}.debridmediamanager.com/${imdbId}-small.jpg`;
};

const Poster = ({ imdbId, title = 'No poster' }: Record<string, string>) => {
	const [posterUrl, setPosterUrl] = useState('');
	const [fallbackAttempted, setFallbackAttempted] = useState(false);

	useEffect(() => {
		// Only set poster URL if we have a valid imdbId
		if (imdbId) {
			setPosterUrl(getPosterUrl(imdbId));
			setFallbackAttempted(false);
		}
	}, [imdbId]);

	const handleImageError = async () => {
		if (!fallbackAttempted) {
			// First error - try API endpoint
			setFallbackAttempted(true);

			// If we have an imdbId, try the API endpoint first
			if (imdbId) {
				try {
					const response = await fetch(`/api/poster?imdbid=${imdbId}`);
					if (response.ok) {
						const data = await response.json();
						setPosterUrl(data.url);
						return;
					}
					throw new Error('API failed');
				} catch (error) {
					// If API fails, fall through to fakeimg.pl
				}
			}

			// Use fakeimg.pl as final fallback
			const encodedTitle = encodeURIComponent(title);
			setPosterUrl(
				`https://fakeimg.pl/400x600/282828/eae0d0?font_size=40&font=bebas&text=${encodedTitle}&w=640&q=75`
			);
		}
	};

	return (
		<div className="relative aspect-[2/3] w-full overflow-hidden rounded bg-gray-800">
			{posterUrl ? (
				<Image
					fill
					sizes="(max-width: 640px) 50vw, (max-width: 768px) 33vw, (max-width: 1024px) 25vw, 20vw"
					src={posterUrl}
					alt={`Poster for ${title}`}
					loading="lazy"
					onError={handleImageError}
					className="object-cover"
				/>
			) : (
				<div className="absolute inset-0 flex items-center justify-center text-gray-600">
					<div className="p-2 text-center text-sm">Loading...</div>
				</div>
			)}
		</div>
	);
};

export default Poster;
