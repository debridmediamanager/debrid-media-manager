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
