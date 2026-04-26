// Client-side pipeline for AllDebrid cast operations.
//
// AllDebrid blocks `magnet/upload` from datacenter IPs (NO_SERVER), so the cast
// flow has to run from the user's browser instead of the DMM server. The output
// of this pipeline is metadata that is POSTed to a thin save endpoint.
//
// Indexing rule (must match `pages/api/stremio-ad/[userid]/play/[hash].ts`):
//   videoFiles = flatten(magnet.files).filter(isVideo).sort(by basename)
// `fileIndex` saved to DB is the position in this sorted array.

import {
	getMagnetFiles,
	getMagnetStatusAd,
	isAdStatusReady,
	MagnetFile,
	uploadMagnet,
} from '@/services/allDebrid';
import { delay } from '@/utils/delay';
import ptt from 'parse-torrent-title';

const VIDEO_EXTENSIONS = ['.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v'];
const POLL_INTERVAL_MS = 5000;
const MAX_POLL_ATTEMPTS = 60;

export interface FlatFile {
	path: string;
	size: number;
	link: string;
}

export interface PreparedFile {
	fileIndex: number; // index in sorted videoFiles
	link: string;
	filename: string; // basename only
	fileSize: number; // MB
	season?: number;
	episode?: number;
}

export interface PreparedMagnet {
	magnetId: number;
	videoFiles: FlatFile[]; // sorted videoFiles (canonical order matching /play/)
}

function flattenFiles(files: MagnetFile[], parentPath = ''): FlatFile[] {
	const out: FlatFile[] = [];
	for (const f of files) {
		const fullPath = parentPath ? `${parentPath}/${f.n}` : f.n;
		if (f.l) out.push({ path: fullPath, size: f.s || 0, link: f.l });
		else if (f.e) out.push(...flattenFiles(f.e, fullPath));
	}
	return out;
}

export function selectSortedVideos(magnetFiles: MagnetFile[]): FlatFile[] {
	return flattenFiles(magnetFiles)
		.filter((f) => {
			const name = f.path.split('/').pop()?.toLowerCase() || '';
			return VIDEO_EXTENSIONS.some((ext) => name.endsWith(ext));
		})
		.sort((a, b) => {
			const aName = a.path.split('/').pop() || '';
			const bName = b.path.split('/').pop() || '';
			return aName.localeCompare(bName);
		});
}

async function waitForReady(apiKey: string, magnetId: number): Promise<void> {
	for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
		const status = await getMagnetStatusAd(apiKey, magnetId);
		if (status && isAdStatusReady(status)) return;
		if (status && status.statusCode >= 5) {
			throw new Error(`Magnet failed: ${status.status}`);
		}
		await delay(POLL_INTERVAL_MS);
	}
	throw new Error('Magnet did not become ready in time');
}

// Upload + wait + getFiles, returning the magnetId and the canonical sorted videoFiles.
export async function prepareMagnetForCast(apiKey: string, hash: string): Promise<PreparedMagnet> {
	const upload = await uploadMagnet(apiKey, [hash]);
	const magnet = upload.magnets?.[0];
	if (!magnet) throw new Error('Upload returned no magnet');
	if (magnet.error) throw new Error(magnet.error.message);
	const magnetId = magnet.id!;

	if (!magnet.ready) await waitForReady(apiKey, magnetId);

	const filesResult = await getMagnetFiles(apiKey, [magnetId]);
	const magnetFiles = filesResult.magnets?.[0];
	if (!magnetFiles) throw new Error('Magnet files unavailable');
	if (magnetFiles.error) throw new Error(magnetFiles.error.message);

	const videoFiles = selectSortedVideos(magnetFiles.files || []);
	if (videoFiles.length === 0) throw new Error('No video files in magnet');
	return { magnetId, videoFiles };
}

export function pickBiggestVideo(videoFiles: FlatFile[]): PreparedFile {
	let best = 0;
	for (let i = 1; i < videoFiles.length; i++) {
		if (videoFiles[i].size > videoFiles[best].size) best = i;
	}
	const f = videoFiles[best];
	const filename = f.path.split('/').pop() || 'Unknown';
	return {
		fileIndex: best,
		link: f.link,
		filename,
		fileSize: Math.round(f.size / 1024 / 1024),
	};
}

// Match a requested filename (basename, case-insensitive) to its position in sorted videoFiles.
export function findVideoByName(
	videoFiles: FlatFile[],
	requestedFilename: string
): PreparedFile | null {
	const target = (requestedFilename.split('/').pop() || requestedFilename).toLowerCase();
	const idx = videoFiles.findIndex(
		(v) => (v.path.split('/').pop() || '').toLowerCase() === target
	);
	if (idx < 0) return null;
	const f = videoFiles[idx];
	const filename = f.path.split('/').pop() || 'Unknown';
	const info = ptt.parse(filename);
	return {
		fileIndex: idx,
		link: f.link,
		filename,
		fileSize: Math.round(f.size / 1024 / 1024),
		season: info.season,
		episode: info.episode,
	};
}
