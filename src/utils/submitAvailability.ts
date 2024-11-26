import { PlanetScaleCache } from '@/services/planetscale';
import { TorrentInfoResponse } from '@/services/types';

const db = new PlanetScaleCache();

export async function handleDownloadedTorrent(
	torrentInfo: TorrentInfoResponse,
	hash: string,
	imdbId: string
): Promise<void> {
	const selectedFiles = torrentInfo.files?.filter((file) => file.selected === 1) || [];

	if (selectedFiles.length === 0 || selectedFiles.length !== (torrentInfo.links?.length || 0)) {
		if (torrentInfo.status === 'downloaded') {
			torrentInfo.status = 'partially_downloaded';
		}
	}

	if (!torrentInfo.ended) {
		torrentInfo.ended = '0';
	}

	const baseData = {
		hash,
		imdbId,
		filename: torrentInfo.filename,
		originalFilename: torrentInfo.original_filename,
		bytes: BigInt(torrentInfo.bytes || 0),
		originalBytes: BigInt(torrentInfo.original_bytes || 0),
		host: 'real-debrid.com',
		progress: torrentInfo.progress,
		status: torrentInfo.status,
		ended: new Date(torrentInfo.ended),
	};

	await db.prisma.available.upsert({
		where: { hash },
		update: {
			...baseData,
			files:
				selectedFiles.length > 0
					? {
							deleteMany: {},
							create: selectedFiles.map((file, index) => ({
								link: torrentInfo.links?.[index] || '',
								file_id: file.id,
								path: file.path,
								bytes: BigInt(file.bytes || 0),
							})),
						}
					: undefined,
		},
		create: {
			...baseData,
			files:
				selectedFiles.length > 0
					? {
							create: selectedFiles.map((file, index) => ({
								link: torrentInfo.links?.[index] || '',
								file_id: file.id,
								path: file.path,
								bytes: BigInt(file.bytes || 0),
							})),
						}
					: undefined,
		},
	});
}
