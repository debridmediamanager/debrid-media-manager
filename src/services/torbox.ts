import axios from 'axios';
import FormData from 'form-data';
import getConfig from 'next/config';

const { publicRuntimeConfig: config } = getConfig();

interface UserResponse {
	// Add user properties based on API response when known
	[key: string]: any;
}

interface CreateTorrentRequest {
	file?: Buffer;
	magnet?: string;
	seed?: number;
	allow_zip?: boolean;
	name?: string;
	as_queued?: boolean;
}

interface ControlTorrentRequest {
	operation: string;
	torrent_id: number;
	all?: boolean;
}

interface ControlQueuedRequest {
	operation: string;
	queued_id: number;
	all?: boolean;
}

// User-related functions

/**
 * Refresh the user's API token using their session token
 * @param sessionToken The user's session token from the website
 * @returns A new API token
 */
export const refreshToken = async (sessionToken: string): Promise<string> => {
	try {
		const response = await axios.post<string>(
			`${config.torboxHostname}/v1/api/user/refreshtoken`,
			{ session_token: sessionToken }
		);
		return response.data;
	} catch (error: any) {
		console.error('Error refreshing token:', error.message);
		throw error;
	}
};

/**
 * Get the user's information and optionally their settings
 * @param apiKey The user's API key
 * @param includeSettings Whether to include user settings in the response
 * @returns User information and optionally settings
 */
export const getUser = async (
	apiKey: string,
	includeSettings: boolean = false
): Promise<UserResponse> => {
	try {
		const response = await axios.get<UserResponse>(`${config.torboxHostname}/v1/api/user/me`, {
			params: { settings: includeSettings },
			headers: {
				Authorization: `Bearer ${apiKey}`,
			},
		});
		return response.data;
	} catch (error: any) {
		console.error('Error fetching user info:', error.message);
		throw error;
	}
};

/**
 * Add a referral to the user's account
 * @param apiKey The user's API key
 * @param referral The referral code to add
 * @returns Response from the server
 */
export const addReferral = async (apiKey: string, referral: string): Promise<string> => {
	try {
		const response = await axios.post<string>(
			`${config.torboxHostname}/v1/api/user/addreferral`,
			null,
			{
				params: { referral },
				headers: {
					Authorization: `Bearer ${apiKey}`,
				},
			}
		);
		return response.data;
	} catch (error: any) {
		console.error('Error adding referral:', error.message);
		throw error;
	}
};

/**
 * Authorize a new user (sign up)
 * @param email User's email address
 * @param password User's password
 * @returns Response from the server
 */
export const authorizeUser = async (email: string, password: string): Promise<string> => {
	try {
		const formData = new URLSearchParams();
		formData.append('email', email);
		formData.append('password', password);

		const response = await axios.post<string>(
			`${config.torboxHostname}/v1/api/user/auth`,
			formData,
			{
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
				},
			}
		);
		return response.data;
	} catch (error: any) {
		console.error('Error authorizing user:', error.message);
		throw error;
	}
};

/**
 * Delete the user's account
 * @param sessionToken The user's session token
 * @returns Response from the server
 */
export const deleteAccount = async (sessionToken: string): Promise<string> => {
	try {
		const response = await axios.delete<string>(
			`${config.torboxHostname}/v1/api/user/deleteme`,
			{
				data: { session_token: sessionToken },
			}
		);
		return response.data;
	} catch (error: any) {
		console.error('Error deleting account:', error.message);
		throw error;
	}
};

// Torrent-related functions

/**
 * Create a torrent from a file or magnet link
 * @param apiKey The user's API key
 * @param data The torrent creation data
 * @returns Response from the server
 */
export const createTorrent = async (
	apiKey: string,
	data: CreateTorrentRequest
): Promise<string> => {
	try {
		const formData = new FormData();
		if (data.file) formData.append('file', data.file);
		if (data.magnet) formData.append('magnet', data.magnet);
		if (data.seed !== undefined) formData.append('seed', data.seed);
		if (data.allow_zip !== undefined) formData.append('allow_zip', data.allow_zip);
		if (data.name) formData.append('name', data.name);
		if (data.as_queued !== undefined) formData.append('as_queued', data.as_queued);

		const response = await axios.post<string>(
			`${config.torboxHostname}/v1/api/torrents/createtorrent`,
			formData,
			{
				headers: {
					Authorization: `Bearer ${apiKey}`,
					...formData.getHeaders(),
				},
			}
		);
		return response.data;
	} catch (error: any) {
		console.error('Error creating torrent:', error.message);
		throw error;
	}
};

/**
 * Control a torrent
 * @param apiKey The user's API key
 * @param data The control operation data
 * @returns Response from the server
 */
export const controlTorrent = async (
	apiKey: string,
	data: ControlTorrentRequest
): Promise<string> => {
	try {
		const response = await axios.post<string>(
			`${config.torboxHostname}/v1/api/torrents/controltorrent`,
			data,
			{
				headers: {
					Authorization: `Bearer ${apiKey}`,
				},
			}
		);
		return response.data;
	} catch (error: any) {
		console.error('Error controlling torrent:', error.message);
		throw error;
	}
};

/**
 * Get queued torrents
 * @param apiKey The user's API key
 * @returns List of queued torrents
 */
export const getQueuedTorrents = async (apiKey: string): Promise<string> => {
	try {
		const response = await axios.get<string>(
			`${config.torboxHostname}/v1/api/torrents/getqueued`,
			{
				headers: {
					Authorization: `Bearer ${apiKey}`,
				},
			}
		);
		return response.data;
	} catch (error: any) {
		console.error('Error getting queued torrents:', error.message);
		throw error;
	}
};

/**
 * Control a queued torrent
 * @param apiKey The user's API key
 * @param data The control operation data
 * @returns Response from the server
 */
export const controlQueued = async (
	apiKey: string,
	data: ControlQueuedRequest
): Promise<string> => {
	try {
		const response = await axios.post<string>(
			`${config.torboxHostname}/v1/api/torrents/controlqueued`,
			data,
			{
				headers: {
					Authorization: `Bearer ${apiKey}`,
				},
			}
		);
		return response.data;
	} catch (error: any) {
		console.error('Error controlling queued torrent:', error.message);
		throw error;
	}
};

/**
 * Request a download
 * @param token User's token
 * @param torrentId Torrent ID
 * @param fileId Optional file ID
 * @param zipLink Whether to get a zip link
 * @param torrentFile Whether to get the torrent file
 * @returns Download information
 */
export const requestDownload = async (
	token: string,
	torrentId: number,
	fileId: number = 0,
	zipLink: boolean = false,
	torrentFile: boolean = false
): Promise<string> => {
	try {
		const response = await axios.get<string>(
			`${config.torboxHostname}/v1/api/torrents/requestdl`,
			{
				params: {
					token,
					torrent_id: torrentId,
					file_id: fileId,
					zip_link: zipLink,
					torrent_file: torrentFile,
				},
			}
		);
		return response.data;
	} catch (error: any) {
		console.error('Error requesting download:', error.message);
		throw error;
	}
};

/**
 * Get user's torrent list
 * @param apiKey The user's API key
 * @param id Optional torrent ID
 * @param bypassCache Whether to bypass cache
 * @param offset Pagination offset
 * @param limit Pagination limit
 * @returns List of torrents
 */
export const getTorrentList = async (
	apiKey: string,
	id?: number,
	bypassCache: boolean = false,
	offset: number = 0,
	limit: number = 1000
): Promise<string> => {
	try {
		const response = await axios.get<string>(
			`${config.torboxHostname}/v1/api/torrents/mylist`,
			{
				params: {
					id,
					bypass_cache: bypassCache,
					offset,
					limit,
				},
				headers: {
					Authorization: `Bearer ${apiKey}`,
				},
			}
		);
		return response.data;
	} catch (error: any) {
		console.error('Error getting torrent list:', error.message);
		throw error;
	}
};

/**
 * Check if torrents are cached
 * @param apiKey The user's API key
 * @param hashes Array of torrent hashes
 * @param format Response format
 * @param listFiles Whether to list files
 * @returns Cache status information
 */
export const checkCached = async (
	apiKey: string,
	hashes: string[],
	format: string = 'object',
	listFiles: boolean = false
): Promise<string> => {
	try {
		const response = await axios.post<string>(
			`${config.torboxHostname}/v1/api/torrents/checkcached`,
			{ hashes },
			{
				params: {
					format,
					list_files: listFiles,
				},
				headers: {
					Authorization: `Bearer ${apiKey}`,
				},
			}
		);
		return response.data;
	} catch (error: any) {
		console.error('Error checking cached torrents:', error.message);
		throw error;
	}
};

/**
 * Store search torrents
 * @param apiKey The user's API key
 * @param query Search query
 * @returns Search results
 */
export const storeSearch = async (apiKey: string, query: string): Promise<string> => {
	try {
		const response = await axios.put<string>(
			`${config.torboxHostname}/v1/api/torrents/storesearch`,
			null,
			{
				params: { query },
				headers: {
					Authorization: `Bearer ${apiKey}`,
				},
			}
		);
		return response.data;
	} catch (error: any) {
		console.error('Error storing search:', error.message);
		throw error;
	}
};

/**
 * Export torrent data
 * @param apiKey The user's API key
 * @param torrentId Torrent ID
 * @param type Export type
 * @returns Exported data
 */
export const exportTorrentData = async (
	apiKey: string,
	torrentId: number,
	type: string
): Promise<string> => {
	try {
		const response = await axios.get<string>(
			`${config.torboxHostname}/v1/api/torrents/exportdata`,
			{
				params: {
					torrent_id: torrentId,
					type,
				},
				headers: {
					Authorization: `Bearer ${apiKey}`,
				},
			}
		);
		return response.data;
	} catch (error: any) {
		console.error('Error exporting torrent data:', error.message);
		throw error;
	}
};

/**
 * Convert magnet link to torrent file
 * @param apiKey The user's API key
 * @param magnet Magnet link
 * @returns Torrent file data
 */
export const magnetToFile = async (apiKey: string, magnet: string): Promise<string> => {
	try {
		const response = await axios.post<string>(
			`${config.torboxHostname}/v1/api/torrents/magnettofile`,
			{ magnet },
			{
				headers: {
					Authorization: `Bearer ${apiKey}`,
				},
			}
		);
		return response.data;
	} catch (error: any) {
		console.error('Error converting magnet to file:', error.message);
		throw error;
	}
};

/**
 * Get torrent information
 * @param apiKey The user's API key
 * @param hash Torrent hash
 * @param timeout Timeout in seconds
 * @returns Torrent information
 */
export const getTorrentInfo = async (
	apiKey: string,
	hash: string,
	timeout: number = 10
): Promise<string> => {
	try {
		const response = await axios.get<string>(
			`${config.torboxHostname}/v1/api/torrents/torrentinfo`,
			{
				params: {
					hash,
					timeout,
				},
				headers: {
					Authorization: `Bearer ${apiKey}`,
				},
			}
		);
		return response.data;
	} catch (error: any) {
		console.error('Error getting torrent info:', error.message);
		throw error;
	}
};
