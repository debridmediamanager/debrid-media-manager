import Image from 'next/image';
import { useEffect, useState } from 'react';

const Poster = ({ imdbId, title = 'No poster' }: Record<string, string>) => {
	const [posterUrl, setPosterUrl] = useState('');
	const [fallbackAttempted, setFallbackAttempted] = useState(false);

	useEffect(() => {
		// Start with primary URL directly
		setPosterUrl(`https://posters.debridmediamanager.com/${imdbId}-small.jpg`);
		setFallbackAttempted(false);
	}, [imdbId]);

	const handleImageError = async () => {
		if (!fallbackAttempted) {
			// First error - try API endpoint
			setFallbackAttempted(true);
			try {
				const response = await fetch(`/api/poster?imdbid=${imdbId}`);
				if (response.ok) {
					const data = await response.json();
					setPosterUrl(data.url);
					return;
				}
				throw new Error('API failed');
			} catch (error) {
				// If API fails or returns non-ok, use fakeimg.pl as final fallback
				const encodedTitle = encodeURIComponent(title);
				setPosterUrl(
					`https://fakeimg.pl/400x600/282828/eae0d0?font_size=40&font=bebas&text=${encodedTitle}&w=640&q=75`
				);
			}
		}
	};

	return (
		<div>
			{posterUrl && (
				<Image
					width={200}
					height={300}
					src={posterUrl}
					alt={`Poster for ${title}`}
					loading="lazy"
					onError={handleImageError}
				/>
			)}
		</div>
	);
};

export default Poster;
