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

interface UserTorrentResponse {
	id: string;
	filename: string;
	hash: string;
	bytes: number;
	host: string;
	split: number;
	progress: number;
	status: string;
	added: string;
	links: string[];
	ended: string;
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

export const getUserTorrentsList = async (
	accessToken: string,
	offset: number,
	page: number,
	limit: number,
	filter: string
) => {
	try {
		const headers = {
			Authorization: `Bearer ${accessToken}`,
		};

		const response = await axios.get<UserTorrentResponse[]>(
			`${config.realDebridHostname}/rest/1.0/torrents`,
			{ headers, params: { offset, page, limit, filter } }
		);
		return response.data;
	} catch (error: any) {
		console.error('Error fetching user torrents list:', error.message);
		throw error;
	}
};

export const getTorrentInfo = async (accessToken: string, id: string) => {
	try {
		const headers = {
			Authorization: `Bearer ${accessToken}`,
		};

		const response = await axios.get<TorrentInfoResponse>(
			`${config.realDebridHostname}/rest/1.0/torrents/info/${id}`,
			{ headers }
		);
		return response.data;
	} catch (error: any) {
		console.error('Error fetching torrent information:', error.message);
		throw error;
	}
};

export const rdInstantCheck = async (accessToken: string, hashes: string[]) => {
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
		throw error;
	}
};

export const addMagnet = async (accessToken: string, magnet: string): Promise<string> => {
	try {
		const headers = {
			Authorization: `Bearer ${accessToken}`,
			'Content-Type': 'application/x-www-form-urlencoded',
		};
		const data = { magnet };
		const formData = qs.stringify(data);

		const response = await axios.post<AddMagnetResponse>(
			`${config.realDebridHostname}/rest/1.0/torrents/addMagnet`,
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

export const addHashAsMagnet = async (accessToken: string, hash: string): Promise<string> => {
	return await addMagnet(accessToken, `magnet:?xt=urn:btih:${hash}`);
};

export const selectFiles = async (accessToken: string, id: string, files: number[]) => {
	try {
		const headers = {
			Authorization: `Bearer ${accessToken}`,
			'Content-Type': 'application/x-www-form-urlencoded',
		};
		const formData = qs.stringify({ files: files.join(',') });

		await axios.post(
			`${config.realDebridHostname}/rest/1.0/torrents/selectFiles/${id}`,
			formData,
			{ headers }
		);
	} catch (error: any) {
		console.error('Error selecting files:', error.message);
		throw error;
	}
};

export const deleteTorrent = async (accessToken: string, id: string) => {
	try {
		const headers = {
			Authorization: `Bearer ${accessToken}`,
		};

		await axios.delete(`${config.realDebridHostname}/rest/1.0/torrents/delete/${id}`, {
			headers,
		});
	} catch (error: any) {
		console.error('Error deleting torrent:', error.message);
		throw error;
	}
};
