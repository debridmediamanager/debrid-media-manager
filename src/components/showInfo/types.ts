interface Stream {
	codec_type: string;
	codec_name: string;
	tags?: {
		language?: string;
		title?: string;
	};
	width?: number;
	height?: number;
	channels?: number;
	channel_layout?: string;
	side_data_list?: {
		dv_profile?: number;
	}[];
}

export interface MediaInfoResponse {
	SelectedFiles: {
		[key: string]: {
			MediaInfo?: {
				streams: Stream[];
				format: {
					duration: string;
				};
				chapters?: {
					tags: {
						title: string;
					};
				}[];
			};
		};
	};
}

type HiddenField = { name: string; value: string };

export interface ActionButtonProps {
	link?: string;
	onClick?: string;
	text?: string;
	linkParam?: HiddenField;
	linkParams?: HiddenField[];
	id?: string; // optional id for event binding instead of inline onclick
	// Rendered as data-* attributes. Watch buttons carry their per-file details
	// this way so one delegated handler can serve every row.
	data?: Record<string, string>;
}

export interface LibraryActionButtonProps {
	onClick?: string;
	id?: string; // optional id for event binding
	text?: string;
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
