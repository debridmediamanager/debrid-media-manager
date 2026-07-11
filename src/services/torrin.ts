import axios from 'axios';
import qs from 'qs';
import {
	TorrentInfoResponse,
	UnrestrictResponse,
	UserResponse,
	UserTorrentResponse,
	UserTorrentsResult,
} from './types';

// Torrin is a self-hostable, open-source debrid service (AGPL) that exposes a RealDebrid-compatible
// API at {baseUrl}/rest/1.0/*, authed with the instance's API key as a Bearer token. No OAuth: the
// key is issued directly by the torrin instance, so callers pass (baseUrl, apiKey) rather than an
// OAuth access token. Response shapes match RealDebrid's, so the shared types are reused.

const REQUEST_TIMEOUT = 10000;
const TORRENT_REQUEST_TIMEOUT = 60000;

function apiBase(baseUrl: string): string {
	return baseUrl.replace(/\/+$/, '') + '/rest/1.0';
}

function authHeaders(apiKey: string): Record<string, string> {
	return { Authorization: `Bearer ${apiKey}` };
}

function formHeaders(apiKey: string): Record<string, string> {
	return { 'Content-Type': 'application/x-www-form-urlencoded', ...authHeaders(apiKey) };
}

export const getTorrinUser = async (baseUrl: string, apiKey: string): Promise<UserResponse> => {
	const { data } = await axios.get<UserResponse>(`${apiBase(baseUrl)}/user`, {
		headers: authHeaders(apiKey),
		timeout: REQUEST_TIMEOUT,
	});
	return data;
};

export const getTorrinTorrentsList = async (
	baseUrl: string,
	apiKey: string,
	limit: number = 1,
	page: number = 1
): Promise<UserTorrentsResult> => {
	const res = await axios.get<UserTorrentResponse[]>(
		`${apiBase(baseUrl)}/torrents?page=${page}&limit=${limit}&_fresh=${Date.now()}`,
		{ headers: authHeaders(apiKey), timeout: TORRENT_REQUEST_TIMEOUT }
	);
	const total = res.headers['x-total-count'];
	const parsed = total ? parseInt(total, 10) : NaN;
	return {
		data: Array.isArray(res.data) ? res.data : [],
		totalCount: isNaN(parsed) ? null : parsed,
	};
};

export const getTorrinTorrentInfo = async (
	baseUrl: string,
	apiKey: string,
	id: string
): Promise<TorrentInfoResponse> => {
	const { data } = await axios.get<TorrentInfoResponse>(
		`${apiBase(baseUrl)}/torrents/info/${id}`,
		{
			headers: authHeaders(apiKey),
			timeout: REQUEST_TIMEOUT,
		}
	);
	return data;
};

export const addTorrinMagnet = async (
	baseUrl: string,
	apiKey: string,
	hash: string
): Promise<string> => {
	const { data, status } = await axios.post(
		`${apiBase(baseUrl)}/torrents/addMagnet`,
		qs.stringify({ magnet: `magnet:?xt=urn:btih:${hash}` }),
		{ headers: formHeaders(apiKey), timeout: REQUEST_TIMEOUT }
	);
	if (status !== 201) throw new Error(`torrin addMagnet failed, status ${status}`);
	return data.id;
};

export const selectTorrinFiles = async (
	baseUrl: string,
	apiKey: string,
	id: string,
	files: string = 'all'
): Promise<void> => {
	await axios.post(`${apiBase(baseUrl)}/torrents/selectFiles/${id}`, qs.stringify({ files }), {
		headers: formHeaders(apiKey),
		timeout: REQUEST_TIMEOUT,
	});
};

export const deleteTorrinTorrent = async (
	baseUrl: string,
	apiKey: string,
	id: string
): Promise<void> => {
	await axios.delete(`${apiBase(baseUrl)}/torrents/delete/${id}`, {
		headers: authHeaders(apiKey),
		timeout: REQUEST_TIMEOUT,
	});
};

export const unrestrictTorrinLink = async (
	baseUrl: string,
	apiKey: string,
	link: string
): Promise<UnrestrictResponse> => {
	const { data } = await axios.post<UnrestrictResponse>(
		`${apiBase(baseUrl)}/unrestrict/link`,
		qs.stringify({ link }),
		{ headers: formHeaders(apiKey), timeout: REQUEST_TIMEOUT }
	);
	return data;
};

export const torrinInstantCheck = async (
	baseUrl: string,
	apiKey: string,
	hashes: string[]
): Promise<Record<string, unknown>> => {
	if (hashes.length === 0) return {};
	const { data } = await axios.get(
		`${apiBase(baseUrl)}/torrents/instantAvailability/${hashes.join('/')}`,
		{ headers: authHeaders(apiKey), timeout: TORRENT_REQUEST_TIMEOUT }
	);
	return data ?? {};
};
