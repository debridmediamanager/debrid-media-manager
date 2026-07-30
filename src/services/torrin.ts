import axios, { AxiosRequestConfig } from 'axios';
import dns from 'dns';
import net from 'net';
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

function isBlockedAddress(ip: string): boolean {
	let addr = ip;
	if (addr.startsWith('::ffff:')) addr = addr.slice(7);
	const parts = addr.split('.');
	if (parts.length === 4 && parts.every((p) => /^\d+$/.test(p))) {
		const [a, b] = parts.map(Number);
		if (a === 127) return true;
		if (a === 10) return true;
		if (a === 172 && b >= 16 && b <= 31) return true;
		if (a === 192 && b === 168) return true;
		if (a === 169 && b === 254) return true;
		if (a === 100 && b >= 64 && b <= 127) return true;
		return false;
	}
	const v6 = addr.toLowerCase();
	if (v6 === '::' || v6 === '::1') return true;
	if (v6.startsWith('fe80')) return true; // link-local
	if (v6.startsWith('fc') || v6.startsWith('fd')) return true; // unique-local fc00::/7
	return false;
}

function pinnedLookup(
	hostname: string,
	options: dns.LookupOptions,
	callback: (err: NodeJS.ErrnoException | null, address: any, family?: number) => void
): void {
	dns.lookup(hostname, { all: true }, (err, addresses) => {
		if (err) return callback(err, '', 0);
		if (addresses.length === 0 || addresses.some((a) => isBlockedAddress(a.address))) {
			return callback(new Error(`blocked host: ${hostname}`), '', 0);
		}
		if (options && options.all) {
			return callback(null, addresses);
		}
		callback(null, addresses[0].address, addresses[0].family);
	});
}

const guard: Pick<AxiosRequestConfig, 'lookup' | 'maxRedirects'> = {
	lookup: pinnedLookup as AxiosRequestConfig['lookup'],
	maxRedirects: 0,
};

function apiBase(baseUrl: string): string {
	const cleaned = baseUrl.replace(/\/+$/, '');
	let hostname: string;
	try {
		hostname = new URL(cleaned).hostname;
	} catch {
		throw new Error('invalid torrin base URL');
	}
	// IP-literal hosts (e.g. http://127.0.0.1, http://[::1]) never hit the DNS
	// lookup guard, so reject blocked literals directly here.
	const bare = hostname.replace(/^\[|\]$/g, '');
	if (net.isIP(bare) && isBlockedAddress(bare)) {
		throw new Error(`blocked host: ${bare}`);
	}
	return cleaned + '/rest/1.0';
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
		...guard,
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
		{ headers: authHeaders(apiKey), timeout: TORRENT_REQUEST_TIMEOUT, ...guard }
	);
	const total = res.headers['x-total-count'];
	const parsed = total ? parseInt(total, 10) : NaN;
	return {
		data: Array.isArray(res.data) ? res.data : [],
		totalCount: isNaN(parsed) ? null : parsed,
	};
};

export const findTorrinTorrentByHash = async (
	baseUrl: string,
	apiKey: string,
	hash: string
): Promise<UserTorrentResponse | null> => {
	const target = hash.toLowerCase();
	const pageSize = 1000;
	let page = 1;
	let seen = 0;
	let total = Infinity;
	// Page through the whole library. Errors propagate on purpose: a failed lookup
	// must never be mistaken for "not found", which would add a duplicate torrent.
	while (seen < total) {
		const res = await getTorrinTorrentsList(baseUrl, apiKey, pageSize, page);
		const match = res.data.find((t) => t.hash?.toLowerCase() === target);
		if (match) return match;
		if (res.totalCount !== null) total = res.totalCount;
		seen += res.data.length;
		if (res.data.length === 0) break;
		page++;
	}
	return null;
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
			...guard,
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
		{ headers: formHeaders(apiKey), timeout: REQUEST_TIMEOUT, ...guard }
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
		...guard,
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
		...guard,
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
		{ headers: formHeaders(apiKey), timeout: REQUEST_TIMEOUT, ...guard }
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
		{ headers: authHeaders(apiKey), timeout: TORRENT_REQUEST_TIMEOUT, ...guard }
	);
	return data ?? {};
};
