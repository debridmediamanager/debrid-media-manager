import Image from 'next/image';
import { useEffect, useState } from 'react';

const Poster = ({ imdbId, title = 'No poster' }: Record<string, string>) => {
	const [posterUrl, setPosterUrl] = useState('');
	const [loadError, setLoadError] = useState(false);

	useEffect(() => {
		const fetchPosterUrl = async () => {
			setLoadError(false);
			setPosterUrl(`https://posters.debridmediamanager.com/${imdbId}-small.jpg`);
		};
		fetchPosterUrl();
	}, [imdbId, title]);

	const handleImageError = () => {
		if (!loadError) {
			setLoadError(true);
			// Use the fallback poster endpoint
			setPosterUrl(`/poster/${imdbId}`);
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
					unoptimized={loadError} // Disable Next.js image optimization for fallback URL
				/>
			)}
		</div>
	);
};

export default Poster;
