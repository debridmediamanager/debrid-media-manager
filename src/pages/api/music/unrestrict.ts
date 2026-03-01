import {
	addHashAsMagnet,
	deleteTorrent,
	getTorrentInfo,
	unrestrictLink,
} from '@/services/realDebrid';
import { handleSelectFilesInRd } from '@/utils/addMagnet';
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

	const ipAddress = (req.headers['cf-connecting-ip'] as string) ?? req.socket.remoteAddress ?? '';

	let torrentId: string | undefined;

	try {
		// Same flow as cast: add magnet, select files, get fresh link, unrestrict
		torrentId = await addHashAsMagnet(accessToken, hash, false);
		await handleSelectFilesInRd(accessToken, `rd:${torrentId}`, false);
		const torrentInfo = await getTorrentInfo(accessToken, torrentId, false);

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
