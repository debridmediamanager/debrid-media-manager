import axios, { AxiosInstance } from 'axios';
import getConfig from 'next/config';
import qs from 'qs';
import {
	AccessTokenResponse,
	AddMagnetResponse,
	CredentialsResponse,
	DeviceCodeResponse,
	RdInstantAvailabilityResponse,
	TorrentInfoResponse,
	UnrestrictResponse,
	UserResponse,
	UserTorrentResponse,
	UserTorrentsResult,
} from './types';

const { publicRuntimeConfig: config } = getConfig();

// Function to replace #num# with random number 0-9
function getProxyUrl(baseUrl: string): string {
	return baseUrl.replace('#num#', Math.floor(Math.random() * 10).toString());
}

// Validate SHA40 hash format
function isValidSHA40Hash(hash: string): boolean {
	const hashRegex = /^[a-f0-9]{40}$/i;
	return hashRegex.test(hash);
}

export const getDeviceCode = async () => {
	try {
		const url = `${getProxyUrl(config.proxy)}${config.realDebridHostname}/oauth/v2/device/code?client_id=${config.realDebridClientId}&new_credentials=yes`;
		const response = await axios.get<DeviceCodeResponse>(url);
		return response.data;
	} catch (error: any) {
		console.error('Error fetching device code:', error.message);
		throw error;
	}
};

export const getCredentials = async (deviceCode: string) => {
	try {
		const url = `${getProxyUrl(config.proxy)}${config.realDebridHostname}/oauth/v2/device/credentials?client_id=${config.realDebridClientId}&code=${deviceCode}`;
		const response = await axios.get<CredentialsResponse>(url);
		return response.data;
	} catch (error: any) {
		console.error('Error fetching credentials:', error.message);
		throw error;
	}
};

export const getToken = async (
	clientId: string,
	clientSecret: string,
	refreshToken: string,
	bare: boolean = false
) => {
	try {
		console.log('[RD API] getToken - starting request');
		const params = new URLSearchParams();
		params.append('client_id', clientId);
		params.append('client_secret', clientSecret);
		params.append('code', refreshToken);
		params.append('grant_type', 'http://oauth.net/grant_type/device/1.0');

		const url = `${bare ? 'https://api.real-debrid.com' : getProxyUrl(config.proxy) + config.realDebridHostname}/oauth/v2/token`;
		console.log('[RD API] getToken - using URL:', url);

		const response = await axios.post<AccessTokenResponse>(url, params.toString(), {
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
		});
		console.log('[RD API] getToken - successful response', {
			status: response.status,
			access_token: !!response.data.access_token,
			expires_in: response.data.expires_in,
			refresh_token: !!response.data.refresh_token,
		});
		return response.data;
	} catch (error: any) {
		console.error('[RD API] getToken - error response:', {
			message: error.message,
			status: error.response?.status,
			statusText: error.response?.statusText,
		});
		throw error;
	}
};

export const getCurrentUser = async (accessToken: string) => {
	try {
		console.log('[RD API] getCurrentUser - starting request');
		const client = await createAxiosClient(accessToken);
		const response = await client.get<UserResponse>(
			`${getProxyUrl(config.proxy)}${config.realDebridHostname}/rest/1.0/user`
		);
		console.log('[RD API] getCurrentUser - successful response', {
			status: response.status,
			hasData: !!response.data,
		});
		return response.data;
	} catch (error: any) {
		console.error('[RD API] getCurrentUser - error response:', {
			message: error.message,
			status: error.response?.status,
			statusText: error.response?.statusText,
		});
		throw error;
	}
};

export async function getUserTorrentsList(
	accessToken: string,
	limit: number = 1,
	page: number = 1,
	bare: boolean = false
): Promise<UserTorrentsResult> {
	try {
		const client = await createAxiosClient(accessToken);
		const response = await client.get<UserTorrentResponse[]>(
			`${bare ? 'https://api.real-debrid.com' : getProxyUrl(config.proxy) + config.realDebridHostname}/rest/1.0/torrents`,
			{
				params: { page, limit },
			}
		);

		const {
			data,
			headers: { 'x-total-count': totalCount },
		} = response;

		// Parse the totalCount from the headers
		let totalCountValue: number | null = null;
		if (totalCount) {
			totalCountValue = parseInt(totalCount, 10);
			if (isNaN(totalCountValue)) {
				totalCountValue = null;
			}
		}

		return { data, totalCount: totalCountValue };
	} catch (error: any) {
		console.error('Error fetching user torrents list:', error.message);
		throw error;
	}
}

export const getTorrentInfo = async (
	accessToken: string,
	id: string,
	bare: boolean = false
): Promise<TorrentInfoResponse> => {
	try {
		const client = await createAxiosClient(accessToken);
		const response = await client.get<TorrentInfoResponse>(
			`${bare ? 'https://api.real-debrid.com' : getProxyUrl(config.proxy) + config.realDebridHostname}/rest/1.0/torrents/info/${id}`
		);
		return response.data;
	} catch (error: any) {
		console.error('Error fetching torrent information:', error.message);
		throw error;
	}
};

export const rdInstantCheck = async (
	accessToken: string,
	hashes: string[]
): Promise<RdInstantAvailabilityResponse> => {
	try {
		// Filter out invalid hashes
		const validHashes = hashes.filter((hash) => isValidSHA40Hash(hash));

		if (validHashes.length === 0) {
			return {}; // Return empty response if no valid hashes
		}

		const client = await createAxiosClient(accessToken);
		const response = await client.get<RdInstantAvailabilityResponse>(
			`${getProxyUrl(config.proxy)}${config.realDebridHostname}/rest/1.0/torrents/instantAvailability/${validHashes.join('/')}`
		);
		return response.data;
	} catch (error: any) {
		console.error('Error fetching torrent information:', error.message);
		throw error;
	}
};

export const addMagnet = async (
	accessToken: string,
	magnet: string,
	bare: boolean = false
): Promise<string> => {
	try {
		const client = await createAxiosClient(accessToken);
		const response = await client.post<AddMagnetResponse>(
			`${bare ? 'https://api.real-debrid.com' : getProxyUrl(config.proxy) + config.realDebridHostname}/rest/1.0/torrents/addMagnet`,
			qs.stringify({ magnet }),
			{
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
				},
			}
		);
		if (response.status !== 201) {
			throw new Error('Failed to add magnet, status: ' + response.status);
		}
		return response.data.id;
	} catch (error: any) {
		console.error('Error adding magnet:', error.message);
		throw error;
	}
};

export const addHashAsMagnet = async (
	accessToken: string,
	hash: string,
	bare: boolean = false
): Promise<string> => {
	// Skip invalid hashes
	if (!isValidSHA40Hash(hash)) {
		throw new Error(`Invalid SHA40 hash: ${hash}`);
	}

	return await addMagnet(accessToken, `magnet:?xt=urn:btih:${hash}`, bare);
};

export const selectFiles = async (
	accessToken: string,
	id: string,
	files: string[],
	bare: boolean = false
): Promise<void> => {
	try {
		const client = await createAxiosClient(accessToken);
		const response = await client.post(
			`${bare ? 'https://api.real-debrid.com' : getProxyUrl(config.proxy) + config.realDebridHostname}/rest/1.0/torrents/selectFiles/${id}`,
			qs.stringify({ files: files.join(',') }),
			{
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
				},
			}
		);
	} catch (error: any) {
		console.error('Error selecting files:', error.message);
		throw error;
	}
};

export const deleteTorrent = async (
	accessToken: string,
	id: string,
	bare: boolean = false
): Promise<void> => {
	try {
		const client = await createAxiosClient(accessToken);
		await client.delete(
			`${bare ? 'https://api.real-debrid.com' : getProxyUrl(config.proxy) + config.realDebridHostname}/rest/1.0/torrents/delete/${id}`
		);
	} catch (error: any) {
		console.error('Error deleting torrent:', error.message);
		throw error;
	}
};

export const deleteDownload = async (accessToken: string, id: string): Promise<void> => {
	try {
		const client = await createAxiosClient(accessToken);
		await client.delete(
			`${getProxyUrl(config.proxy)}${config.realDebridHostname}/rest/1.0/downloads/delete/${id}`
		);
	} catch (error: any) {
		console.error('Error deleting download:', error.message);
		throw error;
	}
};

export const unrestrictLink = async (
	accessToken: string,
	link: string,
	ipAddress: string,
	bare: boolean = false
): Promise<UnrestrictResponse> => {
	try {
		const params = new URLSearchParams();
		if (
			/^\d/.test(ipAddress) &&
			!ipAddress.startsWith('192.168') &&
			!ipAddress.startsWith('10.') &&
			!ipAddress.startsWith('127.') &&
			!ipAddress.startsWith('169.254')
		) {
			params.append('ip', ipAddress);
		}
		params.append('link', link);

		const client = await createAxiosClient(accessToken);
		const response = await client.post<UnrestrictResponse>(
			`${bare ? 'https://api.real-debrid.com' : getProxyUrl(config.proxy) + config.realDebridHostname}/rest/1.0/unrestrict/link`,
			params.toString(),
			{
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
				},
			}
		);
		return response.data;
	} catch (error: any) {
		console.error('Error checking unrestrict:', error.message);
		throw error;
	}
};

export const proxyUnrestrictLink = async (
	accessToken: string,
	link: string
): Promise<UnrestrictResponse> => {
	try {
		const body = JSON.stringify({ link });
		const headers = {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${accessToken}`,
		};

		const response = await axios.post<UnrestrictResponse>(
			`https://unrestrict.debridmediamanager.com/`,
			body,
			{ headers }
		);

		return response.data;
	} catch (error: any) {
		console.error('Error checking unrestrict:', error.message);
		throw error;
	}
};

export const getTimeISO = async (): Promise<string> => {
	try {
		const response = await axios.get<string>(
			`${getProxyUrl(config.proxy)}${config.realDebridHostname}/rest/1.0/time/iso`
		);
		return response.data;
	} catch (error: any) {
		console.error('Error fetching time:', error.message);
		throw error;
	}
};

const MIN_REQUEST_INTERVAL = (60 * 1000) / 250; // 240ms between requests

// Function to create an Axios client with a given token
function createAxiosClient(token: string): AxiosInstance {
	const client = axios.create({
		headers: {
			Authorization: `Bearer ${token}`,
		},
	});

	// Rate limiting configuration
	let lastRequestTime = 0;

	// Add request interceptor for rate limiting
	client.interceptors.request.use(async (config) => {
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
	client.interceptors.response.use(
		(response) => response,
		async (error) => {
			const maxRetries = 10;
			let retryCount = 0;

			while (error.response?.status === 429 && retryCount < maxRetries) {
				retryCount++;
				const delay = Math.min(Math.pow(2, retryCount) * 1000, 30000); // Exponential backoff: 2s, 4s, 8s, ... max 30s
				await new Promise((resolve) => setTimeout(resolve, delay));
				try {
					return await client.request(error.config);
				} catch (retryError) {
					error = retryError;
				}
			}

			throw error;
		}
	);

	return client;
}
