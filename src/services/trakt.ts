import axios from 'axios';
import getConfig from 'next/config';

const TRAKT_API_URL = 'https://api.trakt.tv';

const { publicRuntimeConfig: config } = getConfig();
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

export interface TraktUser {
	user: {
		username: string;
		private: boolean;
		name: string;
		vip: boolean;
		vip_ep: boolean;
		ids: {
			slug: string;
			uuid: string;
		};
		joined_at: string;
		location: string;
		about: string;
		gender: string;
		age: number;
		images: {
			avatar: {
				full: string;
			};
		};
		vip_og: boolean;
		vip_years: number;
	};
	account: {
		timezone: string;
		date_format: string;
		time_24hr: boolean;
		cover_image: string;
	};
	sharing_text: {
		watching: string;
		watched: string;
		rated: string;
	};
	limits: {
		list: {
			count: number;
			item_count: number;
		};
		watchlist: {
			item_count: number;
		};
		favorites: {
			item_count: number;
		};
	};
}

export const getTraktUser = async (access_token: string) => {
	try {
		const headers = {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${access_token}`,
			'trakt-api-version': '2',
			'trakt-api-key': config.traktClientId,
		};

		const response = await axios.get<TraktUser>(`${TRAKT_API_URL}/users/settings`, {
			headers: headers,
		});

		if (response.status !== 200) {
			throw new Error(`Error: ${response.status}`);
		}

		const data = await response.data;
		return data;
	} catch (error) {
		console.error(`Failed to fetch Trakt user settings: ${error}`);
		throw error;
	}
};
