const ONE_GIGABYTE = 1024 * 1024 * 1024;

export function isMovie(file: { path: string; bytes: number }) {
	const filePath = file.path.toLowerCase();
	const isVideo = filePath.endsWith('.mkv') || filePath.endsWith('.mp4');
	const isBigFile = file.bytes >= ONE_GIGABYTE;
	return isVideo && isBigFile;
}
