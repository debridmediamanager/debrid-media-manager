import {
	addHashAsMagnet,
	deleteTorrent,
	getTorrentInfo,
	selectFiles,
	unrestrictLink,
} from '@/services/realDebrid';
import { getClientIpFromRequest } from '@/utils/clientIp';
import { NextApiRequest, NextApiResponse } from 'next';

export interface UnrestrictRequest {
	link: string;
	hash: string;
	fileId: number;
	accessToken: string;
}

export interface UnrestrictTrackResponse {
	streamUrl: string;
	filename: string;
	filesize: number;
	mimeType: string;
}

const MIME_TYPES: Record<string, string> = {
	'.flac': 'audio/flac',
	'.mp3': 'audio/mpeg',
	'.m4a': 'audio/mp4',
	'.aac': 'audio/aac',
	'.ogg': 'audio/ogg',
	'.opus': 'audio/opus',
	'.wav': 'audio/wav',
	'.wma': 'audio/x-ms-wma',
};

function getMimeType(filename: string): string {
	const ext = filename.toLowerCase().slice(filename.lastIndexOf('.'));
	return MIME_TYPES[ext] ?? 'audio/mpeg';
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wait for the torrent to have files available (magnet conversion complete).
 * Polls getTorrentInfo until files appear or timeout is reached.
 */
async function waitForFiles(
	accessToken: string,
	torrentId: string,
	maxAttempts = 10,
	intervalMs = 1000
): Promise<Awaited<ReturnType<typeof getTorrentInfo>>> {
	for (let i = 0; i < maxAttempts; i++) {
		const info = await getTorrentInfo(accessToken, torrentId, false);
		if (info.files.length > 0) return info;
		await delay(intervalMs);
	}
	throw new Error('Timed out waiting for torrent files');
}

/**
 * Wait for the torrent to reach "downloaded" status (links available).
 * Polls getTorrentInfo until status is downloaded or timeout is reached.
 */
async function waitForDownloaded(
	accessToken: string,
	torrentId: string,
	maxAttempts = 15,
	intervalMs = 1000
): Promise<Awaited<ReturnType<typeof getTorrentInfo>>> {
	for (let i = 0; i < maxAttempts; i++) {
		const info = await getTorrentInfo(accessToken, torrentId, false);
		if (info.status === 'downloaded' && info.links.length > 0) return info;
		if (info.status === 'error' || info.status === 'dead' || info.status === 'virus') {
			throw new Error(`Torrent status: ${info.status}`);
		}
		await delay(intervalMs);
	}
	throw new Error('Timed out waiting for torrent to be ready');
}

export default async function handler(
	req: NextApiRequest,
	res: NextApiResponse<UnrestrictTrackResponse | { error: string; errorCode?: number }>
) {
	if (req.method !== 'POST') {
		return res.status(405).json({ error: 'Method not allowed' });
	}

	const { hash, fileId, accessToken } = req.body as UnrestrictRequest;

	if (!accessToken) {
		return res.status(401).json({ error: 'Missing access token' });
	}

	if (!hash || fileId === undefined) {
		return res.status(400).json({ error: 'Missing hash or fileId' });
	}

	const ipAddress = getClientIpFromRequest(req);

	let torrentId: string | undefined;

	try {
		torrentId = await addHashAsMagnet(accessToken, hash, false);

		// Wait for magnet conversion to complete (files become available)
		const initialInfo = await waitForFiles(accessToken, torrentId);

		// Select all files (music torrents have no video files)
		const allFileIds = initialInfo.files.map((f) => `${f.id}`);
		await selectFiles(accessToken, torrentId, allFileIds, false);

		// Wait for torrent to reach "downloaded" status so links are populated
		const torrentInfo = await waitForDownloaded(accessToken, torrentId);

		const fileIdx = torrentInfo.files
			.filter((f) => f.selected)
			.findIndex((f) => f.id === fileId);
		const link = torrentInfo.links[fileIdx] ?? torrentInfo.links[0];

		if (!link) {
			throw new Error('No download link found for this track');
		}

		const unrestricted = await unrestrictLink(accessToken, link, ipAddress, false);

		await deleteTorrent(accessToken, torrentId, false);

		return res.status(200).json({
			streamUrl: unrestricted.download,
			filename: unrestricted.filename,
			filesize: unrestricted.filesize,
			mimeType: getMimeType(unrestricted.filename),
		});
	} catch (error: unknown) {
		if (torrentId) {
			try {
				await deleteTorrent(accessToken, torrentId, false);
			} catch {
				// ignore cleanup errors
			}
		}

		const axiosError = (error as any)?.response?.data;
		const errorCode = axiosError?.error_code;
		const errorMessage =
			axiosError?.error || (error as Error)?.message || 'Failed to unrestrict link';

		console.error('[Music Unrestrict] Error:', {
			hash,
			fileId,
			errorCode,
			errorMessage,
			status: (error as any)?.response?.status,
		});

		return res.status(500).json({
			error: errorMessage,
			errorCode,
		});
	}
}
