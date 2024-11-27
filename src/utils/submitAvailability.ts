import { PlanetScaleCache } from '@/services/planetscale';
import { TorrentInfoResponse } from '@/services/types';

const db = new PlanetScaleCache();

export async function handleDownloadedTorrent(
	torrentInfo: TorrentInfoResponse,
	hash: string,
	imdbId: string
): Promise<void> {
	await db.handleDownloadedTorrent(torrentInfo, hash, imdbId);
}
