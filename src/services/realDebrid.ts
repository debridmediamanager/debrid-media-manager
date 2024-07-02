import axios from 'axios';
import getConfig from 'next/config';
import qs from 'qs';

const { publicRuntimeConfig: config } = getConfig();

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

export interface UserResponse {
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
	fake: boolean;
}

interface FileData {
	filename: string;
	filesize: number;
}

interface SelectionVariant {
	[fileId: number]: FileData;
}

interface HosterHash {
	[hoster: string]: SelectionVariant[];
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

export const getDeviceCode = async () => {
	try {
		const response = await axios.get<DeviceCodeResponse>(
			`${config.realDebridHostname}/oauth/v2/device/code`,
			{
				params: {
					client_id: config.realDebridClientId,
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
					client_id: config.realDebridClientId,
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

interface UserTorrentsResult {
	data: UserTorrentResponse[];
	totalCount: number | null;
}

export async function getUserTorrentsList(
	accessToken: string,
	limit: number = 0,
	page: number = 1
): Promise<UserTorrentsResult> {
	const headers = {
		Authorization: `Bearer ${accessToken}`,
	};

	const response = await axios.get<UserTorrentResponse[]>(
		`${config.realDebridHostname}/rest/1.0/torrents`,
		{ headers, params: { page, limit } }
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
		throw error;
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
	return await addMagnet(
		accessToken,
		`magnet:?xt=urn:btih:${hash}&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337%2Fannounce&tr=http%3A%2F%2Ftracker.opentrackr.org%3A1337%2Fannounce&tr=udp%3A%2F%2Fopen.demonii.com%3A1337%2Fannounce&tr=udp%3A%2F%2Fopen.stealth.si%3A80%2Fannounce&tr=udp%3A%2F%2Fexodus.desync.com%3A6969%2Fannounce&tr=udp%3A%2F%2Ftracker.torrent.eu.org%3A451%2Fannounce&tr=udp%3A%2F%2Ftracker1.bt.moack.co.kr%3A80%2Fannounce&tr=udp%3A%2F%2Ftracker.tiny-vps.com%3A6969%2Fannounce&tr=udp%3A%2F%2Ftracker.theoks.net%3A6969%2Fannounce&tr=udp%3A%2F%2Ftracker.bittor.pw%3A1337%2Fannounce&tr=udp%3A%2F%2Fopen.free-tracker.ga%3A6969%2Fannounce&tr=udp%3A%2F%2Fisk.richardsw.club%3A6969%2Fannounce&tr=udp%3A%2F%2Fexplodie.org%3A6969%2Fannounce&tr=udp%3A%2F%2Fbt1.archive.org%3A6969%2Fannounce&tr=https%3A%2F%2Ftracker.tamersunion.org%3A443%2Fannounce&tr=http%3A%2F%2Ftracker1.bt.moack.co.kr%3A80%2Fannounce&tr=udp%3A%2F%2Ftracker1.myporn.club%3A9337%2Fannounce&tr=udp%3A%2F%2Ftracker.dump.cl%3A6969%2Fannounce&tr=udp%3A%2F%2Ftracker.dler.org%3A6969%2Fannounce&tr=udp%3A%2F%2Ftamas3.ynh.fr%3A6969%2Fannounce&tr=udp%3A%2F%2Fryjer.com%3A6969%2Fannounce&tr=udp%3A%2F%2Fretracker01-msk-virt.corbina.net%3A80%2Fannounce&tr=udp%3A%2F%2Fpublic.tracker.vraphim.com%3A6969%2Fannounce&tr=udp%3A%2F%2Fopentracker.io%3A6969%2Fannounce&tr=udp%3A%2F%2Fnew-line.net%3A6969%2Fannounce&tr=udp%3A%2F%2Fmoonburrow.club%3A6969%2Fannounce&tr=udp%3A%2F%2Fepider.me%3A6969%2Fannounce&tr=udp%3A%2F%2F6ahddutb1ucc3cp.ru%3A6969%2Fannounce&tr=https%3A%2F%2Ftracker.renfei.net%3A443%2Fannounce&tr=http%3A%2F%2Ftracker.renfei.net%3A8080%2Fannounce&tr=http%3A%2F%2Ftracker.ipv6tracker.org%3A80%2Fannounce&tr=udp%3A%2F%2Fwepzone.net%3A6969%2Fannounce&tr=udp%3A%2F%2Ftracker2.dler.org%3A80%2Fannounce&tr=udp%3A%2F%2Ftracker.tryhackx.org%3A6969%2Fannounce&tr=udp%3A%2F%2Ftracker.therarbg.to%3A6969%2Fannounce&tr=udp%3A%2F%2Ftracker.therarbg.com%3A6969%2Fannounce&tr=udp%3A%2F%2Ftracker.t-rb.org%3A6969%2Fannounce&tr=udp%3A%2F%2Ftracker.qu.ax%3A6969%2Fannounce&tr=udp%3A%2F%2Ftracker.publictracker.xyz%3A6969%2Fannounce&tr=udp%3A%2F%2Ftracker.fnix.net%3A6969%2Fannounce&tr=udp%3A%2F%2Ftracker.filemail.com%3A6969%2Fannounce&tr=udp%3A%2F%2Ftracker.farted.net%3A6969%2Fannounce&tr=udp%3A%2F%2Ftracker.edkj.club%3A6969%2Fannounce&tr=udp%3A%2F%2Ftracker.ccp.ovh%3A6969%2Fannounce&tr=udp%3A%2F%2Ftracker.0x7c0.com%3A6969%2Fannounce&tr=udp%3A%2F%2Fsu-data.com%3A6969%2Fannounce&tr=udp%3A%2F%2Frun.publictracker.xyz%3A6969%2Fannounce&tr=udp%3A%2F%2Frun-2.publictracker.xyz%3A6969%2Fannounce&tr=udp%3A%2F%2Fpublic.publictracker.xyz%3A6969%2Fannounce&tr=udp%3A%2F%2Fopen.xxtor.com%3A3074%2Fannounce&tr=udp%3A%2F%2Fopen.u-p.pw%3A6969%2Fannounce&tr=udp%3A%2F%2Foh.fuuuuuck.com%3A6969%2Fannounce&tr=udp%3A%2F%2Finferno.demonoid.is%3A3391%2Fannounce&tr=udp%3A%2F%2Ffree.publictracker.xyz%3A6969%2Fannounce&tr=udp%3A%2F%2Fbubu.mapfactor.com%3A6969%2Fannounce&tr=udp%3A%2F%2Fbt2.archive.org%3A6969%2Fannounce&tr=udp%3A%2F%2Fbt.ktrackers.com%3A6666%2Fannounce&tr=udp%3A%2F%2F1c.premierzal.ru%3A6969%2Fannounce&tr=https%3A%2F%2Fwww.peckservers.com%3A9443%2Fannounce&tr=https%3A%2F%2Ftracker.yemekyedim.com%3A443%2Fannounce&tr=https%3A%2F%2Ftracker.loligirl.cn%3A443%2Fannounce&tr=https%3A%2F%2Ftracker.lilithraws.org%3A443%2Fannounce&tr=https%3A%2F%2Ftracker.ipfsscan.io%3A443%2Fannounce&tr=https%3A%2F%2Ftracker.gcrreen.xyz%3A443%2Fannounce&tr=https%3A%2F%2Ftr.burnabyhighstar.com%3A443%2Fannounce&tr=https%3A%2F%2Ft1.hloli.org%3A443%2Fannounce&tr=http%3A%2F%2Fwww.peckservers.com%3A9000%2Fannounce&tr=http%3A%2F%2Fwepzone.net%3A6969%2Fannounce&tr=http%3A%2F%2Ftracker2.dler.org%3A80%2Fannounce&tr=http%3A%2F%2Ftracker.qu.ax%3A6969%2Fannounce&tr=http%3A%2F%2Ftracker.mywaifu.best%3A6969%2Fannounce&tr=http%3A%2F%2Ftracker.files.fm%3A6969%2Fannounce&tr=http%3A%2F%2Ftracker.edkj.club%3A6969%2Fannounce&tr=http%3A%2F%2Ftracker.dler.org%3A6969%2Fannounce&tr=http%3A%2F%2Ftracker.bt4g.com%3A2095%2Fannounce&tr=http%3A%2F%2Fopen.acgtracker.com%3A1096%2Fannounce&tr=http%3A%2F%2Fopen.acgnxtracker.com%3A80%2Fannounce&tr=http%3A%2F%2Fch3oh.ru%3A6969%2Fannounce&tr=http%3A%2F%2Fcanardscitrons.nohost.me%3A6969%2Fannounce&tr=http%3A%2F%2F1337.abcvg.info%3A80%2Fannounce&tr=udp%3A%2F%2Ftracker.srv00.com%3A6969%2Fannounce&tr=udp%3A%2F%2Ftracker.ddunlimited.net%3A6969%2Fannounce&tr=udp%3A%2F%2Ftracker.anima.nz%3A6969%2Fannounce&tr=udp%3A%2F%2Ftracker-udp.gbitt.info%3A80%2Fannounce&tr=udp%3A%2F%2Ftorrents.artixlinux.org%3A6969%2Fannounce&tr=udp%3A%2F%2Fipv4.rer.lol%3A2710%2Fannounce&tr=udp%3A%2F%2Ffh2.cmp-gaming.com%3A6969%2Fannounce&tr=udp%3A%2F%2Fevan.im%3A6969%2Fannounce&tr=udp%3A%2F%2Fconcen.org%3A6969%2Fannounce&tr=udp%3A%2F%2Fbittorrent-tracker.e-n-c-r-y-p-t.net%3A1337%2Fannounce&tr=udp%3A%2F%2Faegir.sexy%3A6969%2Fannounce&tr=https%3A%2F%2Ftracker.gbitt.info%3A443%2Fannounce&tr=https%3A%2F%2Ftracker.cloudit.top%3A443%2Fannounce&tr=http%3A%2F%2Ftracker1.itzmx.com%3A8080%2Fannounce&tr=http%3A%2F%2Ftracker.gbitt.info%3A80%2Fannounce&tr=http%3A%2F%2Fbvarf.tracker.sh%3A2086%2Fannounce&tr=http%3A%2F%2Fbittorrent-tracker.e-n-c-r-y-p-t.net%3A1337%2Fannounce`,
		bare
	);
};

export const selectFiles = async (
	accessToken: string,
	id: string,
	files: string[],
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
			/^\d/.test(ipAddress) &&
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

export interface MediaInfoVideoDetails {
	stream: string;
	lang: string;
	lang_iso: string;
	codec: string;
	colorspace: string;
	width: number;
	height: number;
}

export interface MediaInfoAudioDetails {
	stream: string;
	lang: string;
	lang_iso: string;
	codec: string;
	sampling: number;
	channels: number;
}

export interface MediaInfoSubtitlesDetails {
	stream: string;
	lang: string;
	lang_iso: string;
	type: string;
}

export interface MediaInfoDetails {
	video: { [key: string]: MediaInfoVideoDetails };
	audio: { [key: string]: MediaInfoAudioDetails };
	subtitles: { [key: string]: MediaInfoSubtitlesDetails };
}

export interface MediaInfoResponse {
	filename: string;
	hoster: string;
	link: string;
	type: string;
	season: string | null;
	episode: string | null;
	year: string | null;
	duration: number;
	bitrate: number;
	size: number;
	details: MediaInfoDetails;
	poster_path: string;
	audio_image: string;
	backdrop_path: string;
}

export const getMediaInfo = async (
	accessToken: string,
	downloadId: string,
	bare: boolean = false
): Promise<MediaInfoResponse> => {
	try {
		const headers = {
			Authorization: `Bearer ${accessToken}`,
		};

		const response = await axios.get<MediaInfoResponse>(
			`${
				bare ? 'https://api.real-debrid.com' : config.realDebridHostname
			}/rest/1.0/streaming/mediaInfos/${downloadId}`,
			{ headers }
		);

		return response.data;
	} catch (error: any) {
		console.error('Error fetching media info:', error.message);
		throw error;
	}
};

export const getTimeISO = async (): Promise<string> => {
	try {
		const response = await axios.get<string>(`${config.realDebridHostname}/rest/1.0/time/iso`);
		return response.data;
	} catch (error: any) {
		console.error('Error fetching time:', error.message);
		throw error;
	}
};
