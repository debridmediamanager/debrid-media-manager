import { getTmdbKey } from '@/utils/freekeys';
import axios from 'axios';
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';

const Poster = ({ imdbId, title = 'No poster' }: Record<string, string>) => {
	const [posterUrl, setPosterUrl] = useState('');
	const [imgLoaded, setImgLoaded] = useState(false);
	const imgRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		const fetchData = async () => {
			try {
				setPosterUrl(`https://images.metahub.space/poster/small/${imdbId}/img`);
				const response = await axios.head(
					`https://images.metahub.space/poster/small/${imdbId}/img`
				);
				if (response.status !== 200) {
					throw new Error('Not an image');
				}
			} catch (error) {
				const tmdbKey = getTmdbKey();
				if (tmdbKey) {
					try {
						const response = await axios.get(
							`https://api.themoviedb.org/3/find/${imdbId}?api_key=${tmdbKey}&external_source=imdb_id`
						);
						const baseUrl = 'https://image.tmdb.org/t/p/w200';
						const posterPath =
							response.data.movie_results[0]?.poster_path ||
							response.data.tv_results[0]?.poster_path;

						setPosterUrl(
							posterPath
								? `${baseUrl}${posterPath}`
								: `https://fakeimg.pl/400x600/282828/eae0d0?font_size=40&font=bebas&text=${title}`
						);
					} catch (error) {
						setPosterUrl(
							`https://fakeimg.pl/400x600/282828/eae0d0?font_size=40&font=bebas&text=${title}`
						);
					}
				} else {
					setPosterUrl(
						`https://fakeimg.pl/400x600/282828/eae0d0?font_size=40&font=bebas&text=${title}`
					);
				}
			}
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

		if (imgRef.current) {
			imgObserver.observe(imgRef.current);
		}

		return () => {
			imgObserver.disconnect();
		};
	}, [imdbId, title]);

	return (
		<div ref={imgRef}>
			{imgLoaded && posterUrl && (
				<Image width={200} height={300} src={posterUrl} alt="Movie poster" />
			)}
		</div>
	);
};

export default Poster;
