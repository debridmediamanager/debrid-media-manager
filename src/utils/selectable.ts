import { TorrentInfoResponse } from '@/services/realDebrid';

const FILE_SIZE_PCT_THRESHOLD = 0.25;

export function isVideo(file: { path: string }) {
	const filePath = file.path.toLowerCase();
	if (filePath.startsWith('/rarbg')) return false;
	if (filePath.match(/\bsample\b/)) return false;
	if (filePath.includes('.xxx.')) return false;
	return filePath.endsWith('.mkv') || filePath.endsWith('.mp4');
}

export function getSelectableFiles(files: TorrentInfoResponse['files']) {
	const maxFileSize = Math.max(...files.map((obj) => obj.bytes));
	const selectableFiles = files.filter(
		(f) => f.bytes >= maxFileSize * FILE_SIZE_PCT_THRESHOLD || /e[0123]\d/i.test(f.path)
	);
	return selectableFiles;
}
