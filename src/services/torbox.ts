import axios, { AxiosInstance } from 'axios';
import getConfig from 'next/config';
import { TorBoxResponse, TorBoxStats, TorBoxTorrentInfo, TorBoxUser } from './types';

export type { TorBoxUser };

const { publicRuntimeConfig: config } = getConfig();

// Constants
const MIN_REQUEST_INTERVAL = (60 * 1000) / 500;
const BASE_URL = 'https://api.torbox.app';
const API_VERSION = 'v1';

// Function to create an Axios client with rate limiting and retry logic
// Single axios instance
let axiosInstance: AxiosInstance | null = null;

function createAxiosClient(token: string): AxiosInstance {
	if (!axiosInstance) {
		axiosInstance = axios.create({
			baseURL: config.torboxHostname || BASE_URL,
		});

		// Rate limiting configuration
		let lastRequestTime = 0;

		// Add request interceptor for rate limiting and token
		axiosInstance.interceptors.request.use(async (config) => {
			// Set the current token
			config.headers.Authorization = `Bearer ${token}`;

			// Rate limiting
			const now = Date.now();
			const timeSinceLastRequest = now - lastRequestTime;
			if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
				await new Promise((resolve) =>
					setTimeout(resolve, MIN_REQUEST_INTERVAL - timeSinceLastRequest)
				);
			}
			lastRequestTime = Date.now();
			return config;
		});

		// Add response interceptor for handling 429 errors
		axiosInstance.interceptors.response.use(
			(response) => response,
			async (error) => {
				const maxRetries = 10;
				let retryCount = 0;

				while (error.response?.status === 429 && retryCount < maxRetries) {
					retryCount++;
					const delay = Math.min(Math.pow(2, retryCount) * 1000, 30000);
					await new Promise((resolve) => setTimeout(resolve, delay));
					try {
						return await axiosInstance!.request(error.config);
					} catch (retryError) {
						error = retryError;
					}
				}

				throw error;
			}
		);
	}

	return axiosInstance;
}

// Torrents

export const createTorrent = async (
	accessToken: string,
	params: {
		file?: File;
		magnet?: string;
		seed?: '1' | '2' | '3';
		allow_zip?: boolean;
		name?: string;
		as_queued?: boolean;
	}
): Promise<
	TorBoxResponse<{
		torrent_id?: number;
		auth_id?: string;
		hash?: string;
		queued_id?: number;
	}>
> => {
	try {
		const client = await createAxiosClient(accessToken);
		const formData = new FormData();

		if (params.file) formData.append('file', params.file);
		if (params.magnet) formData.append('magnet', params.magnet);
		if (params.seed) formData.append('seed', params.seed);
		if (params.allow_zip) formData.append('allow_zip', params.allow_zip.toString());
		if (params.name) formData.append('name', params.name);
		if (params.as_queued) formData.append('as_queued', params.as_queued.toString());

		const response = await client.post<TorBoxResponse>(
			`/${API_VERSION}/api/torrents/createtorrent`,
			formData
		);
		return response.data;
	} catch (error: any) {
		console.error('Error creating torrent:', error.message);
		throw error;
	}
};

export const deleteTorrent = async (
	accessToken: string,
	hash: string
): Promise<TorBoxResponse<null>> => {
	try {
		const client = await createAxiosClient(accessToken);
		const response = await client.post<TorBoxResponse<null>>(
			`/${API_VERSION}/api/torrents/controltorrent`,
			{
				hash,
				operation: 'delete',
			}
		);
		return response.data;
	} catch (error: any) {
		console.error('Error deleting torrent:', error.message);
		throw error;
	}
};

export const controlTorrent = async (
	accessToken: string,
	params: {
		torrent_id?: number;
		all?: boolean;
		operation: 'reannounce' | 'delete' | 'resume' | 'pause';
	}
): Promise<TorBoxResponse<null>> => {
	try {
		const client = await createAxiosClient(accessToken);
		const response = await client.post<TorBoxResponse<null>>(
			`/${API_VERSION}/api/torrents/controltorrent`,
			{
				torrent_id: params.torrent_id,
				all: params.all || false,
				operation: params.operation,
			}
		);
		return response.data;
	} catch (error: any) {
		console.error('Error controlling torrent:', error.message);
		throw error;
	}
};

export const requestDownloadLink = async (
	accessToken: string,
	params: {
		torrent_id: number;
		file_id?: number;
		zip_link?: boolean;
		torrent_file?: boolean;
		user_ip?: string;
	}
): Promise<TorBoxResponse<string>> => {
	try {
		const client = await createAxiosClient(accessToken);
		const response = await client.get<TorBoxResponse<string>>(
			`/${API_VERSION}/api/torrents/requestdl`,
			{
				params: {
					token: accessToken,
					...params,
				},
			}
		);
		return response.data;
	} catch (error: any) {
		console.error('Error requesting download link:', error.message);
		throw error;
	}
};

export const getTorrentList = async (
	accessToken: string,
	params?: {
		bypass_cache?: boolean;
		id?: number;
		offset?: number;
		limit?: number;
	}
): Promise<TorBoxResponse<TorBoxTorrentInfo[] | TorBoxTorrentInfo>> => {
	try {
		const client = await createAxiosClient(accessToken);
		const response = await client.get<TorBoxResponse<TorBoxTorrentInfo[] | TorBoxTorrentInfo>>(
			`/${API_VERSION}/api/torrents/mylist`,
			{ params }
		);
		return response.data;
	} catch (error: any) {
		console.error('Error getting torrent list:', error.message);
		throw error;
	}
};

export const checkCached = async (
	accessToken: string,
	params: {
		hash: string;
		format?: 'object' | 'list';
		list_files?: boolean;
	}
): Promise<TorBoxResponse<any>> => {
	try {
		const client = await createAxiosClient(accessToken);
		const response = await client.get<TorBoxResponse<any>>(
			`/${API_VERSION}/api/torrents/checkcached`,
			{
				params: {
					hash: params.hash,
					format: params.format || 'object',
					list_files: params.list_files || false,
				},
			}
		);
		return response.data;
	} catch (error: any) {
		console.error('Error checking cached availability:', error.message);
		throw error;
	}
};

export const getTorrentInfo = async (
	accessToken: string,
	params: {
		hash: string;
		timeout?: number;
	}
): Promise<
	TorBoxResponse<{
		name: string;
		hash: string;
		size: number;
		files: { name: string; size: number }[];
	}>
> => {
	try {
		const client = await createAxiosClient(accessToken);
		const response = await client.get<TorBoxResponse>(
			`/${API_VERSION}/api/torrents/torrentinfo`,
			{
				params: {
					hash: params.hash,
					timeout: params.timeout,
				},
			}
		);
		return response.data;
	} catch (error: any) {
		console.error('Error getting torrent info:', error.message);
		throw error;
	}
};

// General

export const getUpStatus = async (): Promise<TorBoxResponse<null>> => {
	try {
		const response = await axios.get<TorBoxResponse<null>>(`${BASE_URL}/`);
		return response.data;
	} catch (error: any) {
		console.error('Error getting up status:', error.message);
		throw error;
	}
};

export const getStats = async (): Promise<TorBoxResponse<TorBoxStats>> => {
	try {
		const response = await axios.get<TorBoxResponse<TorBoxStats>>(
			`${BASE_URL}/${API_VERSION}/api/stats`
		);
		return response.data;
	} catch (error: any) {
		console.error('Error getting stats:', error.message);
		throw error;
	}
};

// User

export const refreshApiToken = async (
	accessToken: string,
	params: {
		session_token: string;
	}
): Promise<TorBoxResponse<string>> => {
	try {
		const client = await createAxiosClient(accessToken);
		const response = await client.post<TorBoxResponse<string>>(
			`/${API_VERSION}/api/user/refreshtoken`,
			{
				session_token: params.session_token,
			}
		);
		return response.data;
	} catch (error: any) {
		console.error('Error refreshing API token:', error.message);
		throw error;
	}
};

export const getUserData = async (
	accessToken: string,
	params?: {
		settings?: boolean;
	}
): Promise<TorBoxResponse<TorBoxUser>> => {
	try {
		const client = await createAxiosClient(accessToken);
		const response = await client.get<TorBoxResponse<TorBoxUser>>(
			`/${API_VERSION}/api/user/me`,
			{
				params: {
					settings: params?.settings,
				},
			}
		);
		return response.data;
	} catch (error: any) {
		console.error('Error getting user data:', error.message);
		throw error;
	}
};
