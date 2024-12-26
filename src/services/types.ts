export interface DeviceCodeResponse {
	device_code: string;
	user_code: string;
	verification_url: string;
	expires_in: number;
	interval: number;
	direct_verification_url: string;
}

export interface CredentialsResponse {
	client_id: string;
	client_secret: string;
}

export interface AccessTokenResponse {
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

export interface FileData {
	filename: string;
	filesize: number;
}

export interface SelectionVariant {
	[fileId: number]: FileData;
}

export interface HosterHash {
	[hoster: string]: SelectionVariant[];
}

export interface MasterHash {
	[hash: string]: HosterHash;
}

export interface UnrestrictCheckResponse {
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

export interface UserTorrentsResult {
	data: UserTorrentResponse[];
	totalCount: number | null;
}

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

// TorBox Types

export interface TorBoxResponse<T = any> {
	success: boolean;
	error: string | null | boolean;
	detail: string;
	data: T;
}

export interface TorBoxFile {
	id: number;
	md5: string;
	s3_path: string;
	name: string;
	size: number;
	mimetype: string;
	short_name: string;
}

export interface TorBoxTorrentInfo {
	id: number;
	hash: string;
	created_at: string;
	updated_at: string;
	magnet: string;
	size: number;
	active: boolean;
	auth_id: string;
	download_state: string;
	seeds: number;
	peers: number;
	ratio: number;
	progress: number;
	download_speed: number;
	upload_speed: number;
	name: string;
	eta: number;
	server: number;
	torrent_file: boolean;
	expires_at: string;
	download_present: boolean;
	download_finished: boolean;
	files: TorBoxFile[];
	inactive_check: number;
	availability: number;
}

export interface TorBoxUser {
	id: number;
	created_at: string;
	updated_at: string;
	email: string;
	plan: number;
	total_downloaded: number;
	customer: string;
	server: number;
	is_subscribed: boolean;
	premium_expires_at: string;
	cooldown_until: string;
	auth_id: string;
	user_referral: string;
	base_email: string;
	settings?: Record<string, any>;
}

export interface TorBoxStats {
	total_downloads: number;
	total_users: number;
	total_bytes_downloaded: number;
	total_bytes_uploaded: number;
	active_torrents: number;
	active_usenet_downloads: number;
	active_web_downloads: number;
	total_usenet_downloads: number;
	total_torrent_downloads: number;
	total_web_downloads: number;
	total_servers: number;
}
