import axios from 'axios';

const TRAKT_API_URL = 'https://api.trakt.tv';

export interface TraktMedia {
	title: string;
	year: number;
	ids: {
		trakt: number;
		slug: string;
		tvdb?: number;
		imdb: string;
		tmdb: number;
	};
}

// Generic Media Item Interface (used in responses)
export interface TraktMediaItem {
	movie?: TraktMedia;
	show?: TraktMedia;
}

// Generic Function to Fetch Media Data
export const getMediaData = async (
	client_id: string,
	endpoint: string
): Promise<TraktMediaItem[]> => {
	try {
		const headers = {
			'Content-Type': 'application/json',
			'trakt-api-version': 2,
			'trakt-api-key': client_id,
		};

		const response = await axios.get<TraktMediaItem[]>(`${TRAKT_API_URL}/${endpoint}`, {
			headers,
		});

		return response.data;
	} catch (error: any) {
		console.error(`Error fetching data from ${endpoint}:`, error.message);
		throw error;
	}
};
