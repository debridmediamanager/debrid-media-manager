import { MagnetStatus } from '@/services/allDebrid';
import { TorrentInfoResponse } from '@/services/realDebrid';
import { ParsedFilename } from '@ctrl/video-filename-parser';

export enum UserTorrentStatus {
	'waiting' = 'waiting',
	'downloading' = 'downloading',
	'finished' = 'finished',
	'error' = 'error',
}

export interface UserTorrent {
	id: string;
	filename: string;
	title: string;
	hash: string;
	bytes: number;
	progress: number;
	status: UserTorrentStatus;
	serviceStatus: string;
	added: Date;
	// score: number;
	mediaType: 'movie' | 'tv';
	info: ParsedFilename;
	links: string[];
	selectedFiles: SelectedFile[];
	seeders: number;
	speed: number;
	rdData?: TorrentInfoResponse;
	adData?: MagnetStatus;
}

export interface CachedHash {
	hash: string;
	added: Date;
}

export interface SelectedFile {
	fileId: string;
	filename: string;
	filesize: number;
	link: string;
}

export const uniqId = (torrent: UserTorrent): string => `${torrent.hash}|${torrent.links.join()}`;

export const keyByStatus = (status: string) => {
	if (status === 'sametitleorhash') return (torrent: UserTorrent) => torrent.title;
	return (torrent: UserTorrent) => torrent.hash;
};
