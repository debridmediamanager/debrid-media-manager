import { getTmdbKey } from '../utils/freekeys';
import axios from 'axios';
import Image from 'next/image';
import { useEffect, useState } from 'react';

const Poster = ({ imdbId, title = 'No poster' }: Record<string, string>) => {
	const [posterUrl, setPosterUrl] = useState('');

	useEffect(() => {
		const fetchPosterUrl = async () => {
			setPosterUrl(`https://posters.debridmediamanager.com/${imdbId}-small.jpg`);
		};

		fetchPosterUrl();
	}, [imdbId, title]);

	return (
		<div>
			{posterUrl && (
				<Image
					width={200}
					height={300}
					src={posterUrl}
					alt={`Poster for ${title}`}
					loading="lazy"
				/>
			)}
		</div>
	);
};

export default Poster;
