import axios from 'axios';
import getConfig from 'next/config';

const TRAKT_API_URL = 'https://api.trakt.tv';

const { publicRuntimeConfig: config } = getConfig();
export interface TraktMedia {
	title: string;
	year: number;
	ids?: {
		trakt: number;
		slug: string;
		tvdb?: number;
		imdb?: string;
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

export const getTraktUser = async (accessToken: string) => {
	try {
		const headers = {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${accessToken}`,
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

interface TraktListIds {
	trakt: number;
	slug: string;
}

interface TraktListContainer {
	list: TraktList;
}

interface TraktList {
	name: string;
	description: string;
	privacy: string;
	share_link: string;
	type: string;
	display_numbers: boolean;
	allow_comments: boolean;
	sort_by: string;
	sort_how: string;
	created_at: string;
	updated_at: string;
	item_count: number;
	comment_count: number;
	likes: number;
	ids: TraktListIds;
	user: {
		username: string;
		private: boolean;
		name: string;
		vip: boolean;
		vip_ep: boolean;
		ids: {
			slug: string;
		};
	};
}

export const getUsersPersonalLists = async (
	accessToken: string,
	userSlug: string
): Promise<TraktList[]> => {
	const url = `${TRAKT_API_URL}/users/${userSlug}/lists`;
	try {
		const response = await axios.get<TraktList[]>(url, {
			headers: {
				Authorization: `Bearer ${accessToken}`,
				'Content-Type': 'application/json',
				'trakt-api-version': '2',
				'trakt-api-key': config.traktClientId,
			},
		});
		return response.data;
	} catch (error) {
		console.error("Error fetching user's personal lists:", error);
		throw error;
	}
};

export const getLikedLists = async (
	accessToken: string,
	userSlug: string
): Promise<TraktListContainer[]> => {
	const url = `${TRAKT_API_URL}/users/${userSlug}/likes/lists`;
	try {
		const response = await axios.get<TraktListContainer[]>(url, {
			headers: {
				Authorization: `Bearer ${accessToken}`,
				'Content-Type': 'application/json',
				'trakt-api-version': '2',
				'trakt-api-key': config.traktClientId,
			},
		});
		return response.data;
	} catch (error) {
		console.error("Error fetching user's personal lists:", error);
		throw error;
	}
};

export async function fetchListItems(
	accessToken: string,
	userSlug: string,
	listId: number,
	type?: string
): Promise<TraktMediaItem[]> {
	let apiEndpoint = `${TRAKT_API_URL}/users/${userSlug}/lists/${listId}/items`;
	if (type) {
		apiEndpoint += `/${type}`;
	}
	try {
		const response = await axios.get<TraktMediaItem[]>(apiEndpoint, {
			headers: {
				Authorization: `Bearer ${accessToken}`,
				'Content-Type': 'application/json',
				'trakt-api-version': '2',
				'trakt-api-key': config.traktClientId,
			},
		});
		return response.data;
	} catch (error) {
		throw new Error('Error fetching list items');
	}
}

// New interfaces for watchlist items
export interface TraktWatchlistItem {
	rank: number;
	id: number;
	listed_at: string;
	notes: string | null;
	type: 'movie' | 'show';
	movie?: TraktMedia;
	show?: TraktMedia;
}

// New function to fetch watchlist movies
export const getWatchlistMovies = async (accessToken: string): Promise<TraktWatchlistItem[]> => {
	const url = `${TRAKT_API_URL}/sync/watchlist/movies/added`;
	try {
		const response = await axios.get<TraktWatchlistItem[]>(url, {
			headers: {
				Authorization: `Bearer ${accessToken}`,
				'Content-Type': 'application/json',
				'trakt-api-version': '2',
				'trakt-api-key': config.traktClientId,
			},
		});
		return response.data;
	} catch (error) {
		console.error('Error fetching watchlist movies:', error);
		throw error;
	}
};

// New function to fetch watchlist shows
export const getWatchlistShows = async (accessToken: string): Promise<TraktWatchlistItem[]> => {
	const url = `${TRAKT_API_URL}/sync/watchlist/shows/added`;
	try {
		const response = await axios.get<TraktWatchlistItem[]>(url, {
			headers: {
				Authorization: `Bearer ${accessToken}`,
				'Content-Type': 'application/json',
				'trakt-api-version': '2',
				'trakt-api-key': config.traktClientId,
			},
		});
		return response.data;
	} catch (error) {
		console.error('Error fetching watchlist shows:', error);
		throw error;
	}
};

// New interface for collection items
export interface TraktCollectionItem {
	last_collected_at: string;
	last_updated_at: string;
	movie?: TraktMedia;
	show?: TraktMedia;
}

// New function to fetch collection movies
export const getCollectionMovies = async (accessToken: string): Promise<TraktCollectionItem[]> => {
	const url = `${TRAKT_API_URL}/sync/collection/movies`;
	try {
		const response = await axios.get<TraktCollectionItem[]>(url, {
			headers: {
				Authorization: `Bearer ${accessToken}`,
				'Content-Type': 'application/json',
				'trakt-api-version': '2',
				'trakt-api-key': config.traktClientId,
			},
		});
		return response.data;
	} catch (error) {
		console.error('Error fetching collection movies:', error);
		throw error;
	}
};

// New function to fetch collection shows
export const getCollectionShows = async (accessToken: string): Promise<TraktCollectionItem[]> => {
	const url = `${TRAKT_API_URL}/sync/collection/shows`;
	try {
		const response = await axios.get<TraktCollectionItem[]>(url, {
			headers: {
				Authorization: `Bearer ${accessToken}`,
				'Content-Type': 'application/json',
				'trakt-api-version': '2',
				'trakt-api-key': config.traktClientId,
			},
		});
		return response.data;
	} catch (error) {
		console.error('Error fetching collection shows:', error);
		throw error;
	}
};
