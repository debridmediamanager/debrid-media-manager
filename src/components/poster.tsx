import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Image from 'next/image';
import { getTmdbKey } from '@/utils/freekeys';

const TMDBPoster = ({ imdbId }: Record<string, string>) => {
  const [posterUrl, setPosterUrl] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      const response = await axios.get(`https://api.themoviedb.org/3/find/${imdbId}?api_key=${getTmdbKey()}&external_source=imdb_id`);
      const baseUrl = 'https://image.tmdb.org/t/p/w200';
      if (response.data.movie_results.length > 0 && response.data.movie_results[0].poster_path) {
        setPosterUrl(baseUrl + response.data.movie_results[0].poster_path);
      } if (response.data.tv_results.length > 0 && response.data.tv_results[0].poster_path) {
        setPosterUrl(baseUrl + response.data.tv_results[0].poster_path);
      } else {
        // If no poster_path, set a placeholder image URL
        setPosterUrl(`https://picsum.photos/seed/${imdbId}/200/300`);
      }
    };

    try {
      if (imdbId) fetchData();
      else setPosterUrl(`https://picsum.photos/seed/${imdbId}/200/300`);
    } catch (error: any) {
      setPosterUrl(`https://picsum.photos/seed/${imdbId}/200/300`);
    }
  }, [imdbId]);

  return (
    <div>
      {posterUrl && <Image width={200} height={300} src={posterUrl} alt="Movie poster" />}
    </div>
  );
};

export default TMDBPoster;
