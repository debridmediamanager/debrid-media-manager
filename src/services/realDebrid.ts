import axios from 'axios';
import getConfig from 'next/config';
import qs from 'qs';

const RD_OPENSOURCE_CLIENT_ID = 'X245A4XAIBGVM';

interface DeviceCodeResponse {
	device_code: string;
	user_code: string;
	verification_url: string;
	expires_in: number;
	interval: number;
	direct_verification_url: string;
}

interface CredentialsResponse {
	client_id: string;
	client_secret: string;
}

interface AccessTokenResponse {
	access_token: string;
	expires_in: number;
	refresh_token: string;
	token_type: string;
}

interface UserResponse {
	id: number;
	username: string;
	email: string;
	points: number;
	locale: string;
	avatar: string;
	type: string;
	premium: number;
	expiration: string;
}

export interface UserTorrentResponse {
	id: string;
	filename: string;
	hash: string;
	bytes: number;
	host: string;
	split: number;
	progress: number;
	speed: number;
	status: string;
	added: string;
	links: string[];
	ended: string;
	seeders: number;
}

export interface DownloadResponse {
	id: string;
	filename: string;
	mimeType: string;
	filesize: number;
	link: string;
	host: string;
	host_icon: string;
	chunks: number;
	download: string;
	streamable: number;
	generated: string;
}

export interface UnrestrictResponse {
	id: string;
	filename: string;
	mimeType: string;
	filesize: number;
	link: string;
	host: string;
	chunks: number;
	crc: number;
	download: string;
	streamable: number;
}

export interface TorrentInfoResponse {
	id: string;
	filename: string;
	original_filename: string;
	hash: string;
	bytes: number;
	original_bytes: number;
	host: string;
	split: number;
	progress: number;
	status: string;
	added: string;
	files: {
		id: number;
		path: string;
		bytes: number;
		selected: number;
	}[];
	links: string[];
	ended: string;
	speed: number;
	seeders: number;
}

interface FileData {
	filename: string;
	filesize: number;
}

interface FileHash {
	[fileId: number]: FileData;
}

interface HosterHash {
	[hoster: string]: FileHash[];
}

interface MasterHash {
	[hash: string]: HosterHash;
}

interface UnrestrictCheckResponse {
	host: string;
	link: string;
	filename: string;
	filesize: number;
	supported: number;
}

export interface RdInstantAvailabilityResponse extends MasterHash {}

export interface AddMagnetResponse {
	id: string;
	uri: string;
}

const { publicRuntimeConfig: config } = getConfig();

export const getDeviceCode = async () => {
	try {
		const response = await axios.get<DeviceCodeResponse>(
			`${config.realDebridHostname}/oauth/v2/device/code`,
			{
				params: {
					client_id: RD_OPENSOURCE_CLIENT_ID,
					new_credentials: 'yes',
				},
			}
		);
		return response.data;
	} catch (error) {
		console.error('Error fetching device code:', (error as any).message);
		throw error;
	}
};

export const getCredentials = async (deviceCode: string) => {
	try {
		const response = await axios.get<CredentialsResponse>(
			`${config.realDebridHostname}/oauth/v2/device/credentials`,
			{
				params: {
					client_id: RD_OPENSOURCE_CLIENT_ID,
					code: deviceCode,
				},
			}
		);
		return response.data;
	} catch (error: any) {
		console.error('Error fetching credentials:', error.message);
		throw error;
	}
};

export const getToken = async (clientId: string, clientSecret: string, code: string) => {
	try {
		const params = new URLSearchParams();
		params.append('client_id', clientId);
		params.append('client_secret', clientSecret);
		params.append('code', code);
		params.append('grant_type', 'http://oauth.net/grant_type/device/1.0');

		const headers = {
			'Content-Type': 'application/x-www-form-urlencoded',
		};

		const response = await axios.post<AccessTokenResponse>(
			`${config.realDebridHostname}/oauth/v2/token`,
			params.toString(),
			{ headers }
		);
		return response.data;
	} catch (error: any) {
		console.error('Error fetching access token:', error.message);
		throw error;
	}
};

export const getCurrentUser = async (accessToken: string) => {
	try {
		const headers = {
			Authorization: `Bearer ${accessToken}`,
		};

		const response = await axios.get<UserResponse>(
			`${config.realDebridHostname}/rest/1.0/user`,
			{ headers }
		);
		return response.data;
	} catch (error: any) {
		console.error('Error fetching user information:', error.message);
		throw error;
	}
};

export async function* getUserTorrentsList(accessToken: string, limit: number = 0) {
	const headers = {
		Authorization: `Bearer ${accessToken}`,
	};

	let page = 1;
	const limitSet = limit || Infinity;
	if (!limit) limit = 2500;

	while (true) {
		const response = await axios.get<UserTorrentResponse[]>(
			`${config.realDebridHostname}/rest/1.0/torrents`,
			{ headers, params: { page, limit } }
		);

		const {
			data,
			headers: { 'x-total-count': totalCount },
		} = response;

		yield data; // Yield the current page of torrents

		if (data.length < limit || !totalCount) {
			break;
		}

		const totalCountValue = parseInt(totalCount, 10);
		if (isNaN(totalCountValue)) {
			break;
		}

		if (data.length >= limitSet || data.length >= totalCountValue) {
			break;
		}

		page++;
	}
}

export const getDownloads = async (accessToken: string): Promise<DownloadResponse[]> => {
	try {
		const headers = {
			Authorization: `Bearer ${accessToken}`,
		};

		let downloads: DownloadResponse[] = [];
		let page = 1;
		let limit = 2500;

		while (true) {
			const response = await axios.get<DownloadResponse[]>(
				`${config.realDebridHostname}/rest/1.0/downloads`,
				{ headers, params: { page, limit } }
			);

			const {
				data,
				headers: { 'x-total-count': totalCount },
			} = response;
			downloads = downloads.concat(data);

			if (data.length < limit || !totalCount) {
				break;
			}

			const totalCountValue = parseInt(totalCount, 10);
			if (isNaN(totalCountValue)) {
				break;
			}

			if (data.length >= totalCountValue) {
				break;
			}

			page++;
		}

		return downloads;
	} catch (error: any) {
		console.error('Error fetching downloads list:', error.message);
		throw error;
	}
};

export const getTorrentInfo = async (accessToken: string, id: string, bare: boolean = false) => {
	try {
		const headers = {
			Authorization: `Bearer ${accessToken}`,
		};

		const response = await axios.get<TorrentInfoResponse>(
			`${
				bare ? 'https://api.real-debrid.com' : config.realDebridHostname
			}/rest/1.0/torrents/info/${id}`,
			{ headers }
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
		const headers = {
			Authorization: `Bearer ${accessToken}`,
		};

		const response = await axios.get<RdInstantAvailabilityResponse>(
			`${config.realDebridHostname}/rest/1.0/torrents/instantAvailability/${hashes.join(
				'/'
			)}`,
			{ headers }
		);
		return response.data;
	} catch (error: any) {
		console.error('Error fetching torrent information:', error.message);
		console.log('Retrying availability check...');
		const firstElement = hashes.shift() as string;
		hashes.push(firstElement);
		return rdInstantCheck(accessToken, hashes);
	}
};

export const addMagnet = async (
	accessToken: string,
	magnet: string,
	bare: boolean = false
): Promise<string> => {
	try {
		const headers = {
			Authorization: `Bearer ${accessToken}`,
			'Content-Type': 'application/x-www-form-urlencoded',
		};
		const data = { magnet };
		const formData = qs.stringify(data);

		const response = await axios.post<AddMagnetResponse>(
			`${
				bare ? 'https://api.real-debrid.com' : config.realDebridHostname
			}/rest/1.0/torrents/addMagnet`,
			formData,
			{
				headers,
			}
		);
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
	return await addMagnet(accessToken, `magnet:?xt=urn:btih:${hash}`, bare);
};

export const selectFiles = async (
	accessToken: string,
	id: string,
	files: number[],
	bare: boolean = false
) => {
	try {
		const headers = {
			Authorization: `Bearer ${accessToken}`,
			'Content-Type': 'application/x-www-form-urlencoded',
		};
		const formData = qs.stringify({ files: files.join(',') });

		await axios.post(
			`${
				bare ? 'https://api.real-debrid.com' : config.realDebridHostname
			}/rest/1.0/torrents/selectFiles/${id}`,
			formData,
			{ headers }
		);
	} catch (error: any) {
		console.error('Error selecting files:', error.message);
		throw error;
	}
};

export const deleteTorrent = async (accessToken: string, id: string, bare: boolean = false) => {
	try {
		const headers = {
			Authorization: `Bearer ${accessToken}`,
		};

		await axios.delete(
			`${
				bare ? 'https://api.real-debrid.com' : config.realDebridHostname
			}/rest/1.0/torrents/delete/${id}`,
			{
				headers,
			}
		);
	} catch (error: any) {
		console.error('Error deleting torrent:', error.message);
		throw error;
	}
};

export const deleteDownload = async (accessToken: string, id: string) => {
	try {
		const headers = {
			Authorization: `Bearer ${accessToken}`,
		};

		await axios.delete(`${config.realDebridHostname}/rest/1.0/downloads/delete/${id}`, {
			headers,
		});
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
			!ipAddress.startsWith('192.168') &&
			!ipAddress.startsWith('10.') &&
			!ipAddress.startsWith('127.') &&
			!ipAddress.startsWith('169.254')
		)
			params.append('ip', ipAddress);

		params.append('link', link);
		const headers = {
			Authorization: `Bearer ${accessToken}`,
			'Content-Type': 'application/x-www-form-urlencoded',
		};

		const response = await axios.post<UnrestrictResponse>(
			`${
				bare ? 'https://api.real-debrid.com' : config.realDebridHostname
			}/rest/1.0/unrestrict/link`,
			params.toString(),
			{ headers }
		);

		return response.data;
	} catch (error: any) {
		console.error('Error checking unrestrict:', error.message);
		throw error;
	}
};
