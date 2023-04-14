import { TorrentInfoResponse } from '@/services/realDebrid';

const FILE_SIZE_PCT_THRESHOLD = 0.4;

export function isVideo(file: { path: string }) {
	const filePath = file.path.toLowerCase();
	return filePath.endsWith('.mkv') || filePath.endsWith('.mp4');
}

export function getSelectableFiles(files: TorrentInfoResponse['files']) {
	const maxFileSize = Math.max(...files.map((obj) => obj.bytes));
	const selectableFiles = files.filter((f) => f.bytes >= maxFileSize * FILE_SIZE_PCT_THRESHOLD);
	return selectableFiles;
}
