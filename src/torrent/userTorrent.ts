import { ParsedFilename } from '@ctrl/video-filename-parser';

export interface UserTorrent {
	id: string;
	filename: string;
	title: string;
	hash: string;
	bytes: number;
	progress: number;
	status: string;
	added: string;
	score: number;
	mediaType: 'movie' | 'tv';
	info: ParsedFilename;
	links: string[];
	seeders: number;
	speed: number;
}

export interface CachedHash {
	hash: string;
	added: Date;
}

export interface TorrentFile {
	fileId: string;
	filename: string;
	filesize: number;
}

export const uniqId = (torrent: UserTorrent): string => `${torrent.hash}|${torrent.links.join()}`;

export const keyByStatus = (status: string) => {
	if (status === 'sametitleorhash') return (torrent: UserTorrent) => torrent.title;
	return (torrent: UserTorrent) => torrent.hash;
};
