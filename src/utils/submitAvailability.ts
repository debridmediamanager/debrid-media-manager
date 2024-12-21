import { Repository } from '@/services/repository';
import { TorrentInfoResponse } from '@/services/types';

const db = new Repository();

export async function handleDownloadedTorrent(
	torrentInfo: TorrentInfoResponse,
	hash: string,
	imdbId: string
): Promise<void> {
	await db.handleDownloadedTorrent(torrentInfo, hash, imdbId);
}
