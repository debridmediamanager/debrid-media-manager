import { getTmdbKey } from '@/utils/freekeys';
import axios from 'axios';
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';

const Poster = ({ imdbId }: Record<string, string>) => {
	const [posterUrl, setPosterUrl] = useState('');
	const [imgLoaded, setImgLoaded] = useState(false);
	const imgRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		const fetchData = async () => {
			const response = await axios.get(
				`https://api.themoviedb.org/3/find/${imdbId}?api_key=${getTmdbKey()}&external_source=imdb_id`
			);
			const baseUrl = 'https://image.tmdb.org/t/p/w200';
			const posterPath =
				response.data.movie_results[0]?.poster_path ||
				response.data.tv_results[0]?.poster_path;
			if (!posterPath) setPosterUrl(`https://picsum.photos/seed/${imdbId}/200/300`);
			else setPosterUrl(`${baseUrl}${posterPath}`);
		};

		const imgObserver = new IntersectionObserver((entries, observer) => {
			entries.forEach((entry) => {
				if (entry.isIntersecting) {
					fetchData();
					setImgLoaded(true);
					observer.disconnect();
				}
			});
		});

		try {
			if (imdbId && imgRef.current) {
				imgObserver.observe(imgRef.current);
			} else {
				setPosterUrl(`https://picsum.photos/seed/${imdbId}/200/300`);
			}
		} catch (error: any) {
			setPosterUrl(`https://picsum.photos/seed/${imdbId}/200/300`);
		}

		return () => {
			imgObserver.disconnect();
		};
	}, [imdbId]);

	return (
		<div ref={imgRef}>
			{imgLoaded && posterUrl && (
				<Image width={200} height={300} src={posterUrl} alt="Movie poster" />
			)}
		</div>
	);
};

export default Poster;
