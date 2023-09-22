import { TorrentInfoResponse } from '@/services/realDebrid';

const FILE_SIZE_PCT_THRESHOLD = 0.15;

export function isVideoOrSubs(file: { path: string }) {
	const filePath = `${file.path}`.toLowerCase();
	if (filePath.startsWith('/rarbg')) return false;
	if (filePath.match(/\bsample\b/)) return false;
	if (filePath.includes('.xxx.')) return false;
	return (
		filePath.endsWith('.mkv') ||
		filePath.endsWith('.mp4') ||
		filePath.endsWith('.srt') ||
		filePath.endsWith('.smi') ||
		filePath.endsWith('.ssa') ||
		filePath.endsWith('.ass') ||
		filePath.endsWith('.vtt')
	);
}

export function getSelectableFiles(files: TorrentInfoResponse['files']) {
	// const maxFileSize = Math.max(...files.map((obj) => obj.bytes));
	// return files.filter(
	// 	(f) => f.bytes >= maxFileSize * FILE_SIZE_PCT_THRESHOLD || /[ex][0123]\d/i.test(f.path)
	// );
	return files;
}
