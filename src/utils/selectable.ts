import { TorrentInfoResponse } from '@/services/realDebrid';

const FILE_SIZE_PCT_THRESHOLD = 0.25;

export function isVideo(file: { path: string }) {
	const filePath = file.path.toLowerCase();
	if (filePath.endsWith('/rarbg.com.mp4')) return false;
	return filePath.endsWith('.mkv') || filePath.endsWith('.mp4');
}

export function getSelectableFiles(files: TorrentInfoResponse['files']) {
	const maxFileSize = Math.max(...files.map((obj) => obj.bytes));
	const selectableFiles = files.filter((f) => f.bytes >= maxFileSize * FILE_SIZE_PCT_THRESHOLD);
	return selectableFiles;
}
