import { MagnetStatus } from '../../services/allDebrid';
import { TorrentInfoResponse } from '../../services/types';

export interface ActionButtonProps {
	link?: string;
	onClick?: string;
	text?: string;
	linkParam?: { name: string; value: string };
}

export interface LibraryActionButtonProps {
	onClick: string;
}

export interface FileRowProps {
	id: number;
	path: string;
	size: number;
	isSelected?: boolean;
	isPlayable?: boolean;
	actions: string[];
}

export interface InfoTableRow {
	label: string;
	value: string | number;
}

export interface ApiTorrentFile {
	id: number;
	path: string;
	bytes: number;
	selected: number;
}

export interface MagnetLink {
	filename: string;
	link: string;
	size: number;
}

export interface ShowInfoProps {
	info: TorrentInfoResponse | MagnetStatus;
	isRd: boolean;
	rdKey: string;
	app?: string;
	imdbId?: string;
	mediaType?: 'movie' | 'tv';
}
