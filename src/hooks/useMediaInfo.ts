import axios from 'axios';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';

interface BaseMediaInfo {
	title: string;
	description: string;
	poster: string;
	backdrop: string;
	imdb_score: number;
}

interface MovieInfo extends BaseMediaInfo {
	year: string;
}

interface ShowInfo extends BaseMediaInfo {
	season_count: number;
	season_names: string[];
	season_episode_counts: Record<number, number>;
}

type MediaInfo = MovieInfo | ShowInfo;

interface UseMediaInfoProps {
	mediaType: 'movie' | 'show';
	imdbId?: string;
}

export const useMediaInfo = ({ mediaType, imdbId }: UseMediaInfoProps) => {
	const [mediaInfo, setMediaInfo] = useState<MediaInfo | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const router = useRouter();

	useEffect(() => {
		if (!imdbId) {
			setIsLoading(false);
			return;
		}

		const fetchMediaInfo = async () => {
			try {
				setIsLoading(true);
				setError(null);
				const response = await axios.get(`/api/info/${mediaType}?imdbid=${imdbId}`);
				setMediaInfo(response.data);

				// For TV shows, check if season is valid
				if (mediaType === 'show' && router.query.seasonNum) {
					const seasonNum = parseInt(router.query.seasonNum as string);
					if (seasonNum > response.data.season_count) {
						router.push(`/show/${imdbId}/1`);
					}
				}
			} catch (error) {
				console.error(`Failed to fetch ${mediaType} info:`, error);
				setError(`Failed to fetch ${mediaType} information`);
			} finally {
				setIsLoading(false);
			}
		};

		fetchMediaInfo();
	}, [imdbId, mediaType, router]);

	return { mediaInfo, isLoading, error };
};
