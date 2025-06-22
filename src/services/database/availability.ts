import { TorrentInfoResponse } from '../types';
import { DatabaseClient } from './client';

export class AvailabilityService extends DatabaseClient {
	public async getIMDBIdByHash(hash: string): Promise<string | null> {
		const available = await this.prisma.available.findFirst({
			where: { hash },
			select: { imdbId: true },
		});
		return available?.imdbId || null;
	}

	public async handleDownloadedTorrent(
		torrentInfo: TorrentInfoResponse,
		hash: string,
		imdbId: string
	): Promise<void> {
		const selectedFiles = torrentInfo.files?.filter((file) => file.selected === 1) || [];

		if (
			selectedFiles.length === 0 ||
			selectedFiles.length !== (torrentInfo.links?.length || 0)
		) {
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

		await this.prisma.available.upsert({
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

	public async upsertAvailability({
		hash,
		imdbId,
		filename,
		originalFilename,
		bytes,
		originalBytes,
		host,
		progress,
		status,
		ended,
		selectedFiles,
		links,
	}: {
		hash: string;
		imdbId: string;
		filename: string;
		originalFilename: string;
		bytes: number;
		originalBytes: number;
		host: string;
		progress: number;
		status: string;
		ended: string;
		selectedFiles: Array<{ id: number; path: string; bytes: number; selected: number }>;
		links: string[];
	}) {
		return this.prisma.available.upsert({
			where: {
				hash: hash,
			},
			update: {
				imdbId,
				originalFilename,
				originalBytes: BigInt(originalBytes),
				ended: new Date(ended),
				files: {
					deleteMany: {},
					create: selectedFiles.map((file, index) => ({
						link: links[index],
						file_id: file.id,
						path: file.path,
						bytes: BigInt(file.bytes),
					})),
				},
			},
			create: {
				hash,
				imdbId,
				filename,
				originalFilename,
				bytes: BigInt(bytes),
				originalBytes: BigInt(originalBytes),
				host,
				progress,
				status,
				ended: new Date(ended),
				files: {
					create: selectedFiles.map((file, index) => ({
						link: links[index],
						file_id: file.id,
						path: file.path,
						bytes: BigInt(file.bytes),
					})),
				},
			},
		});
	}

	public async checkAvailability(
		imdbId: string,
		hashes: string[]
	): Promise<
		Array<{
			hash: string;
			files: Array<{
				file_id: number;
				path: string;
				bytes: number;
			}>;
		}>
	> {
		const availableHashes = await this.prisma.available.findMany({
			where: {
				imdbId,
				hash: { in: hashes },
				status: 'downloaded',
			},
			select: {
				hash: true,
				files: {
					select: {
						file_id: true,
						path: true,
						bytes: true,
					},
				},
			},
		});

		return availableHashes.map((record) => ({
			hash: record.hash,
			files: record.files.map((file) => ({
				file_id: file.file_id,
				path: file.path,
				bytes: Number(file.bytes),
			})),
		}));
	}

	public async checkAvailabilityByHashes(hashes: string[]): Promise<
		Array<{
			hash: string;
			files: Array<{
				file_id: number;
				path: string;
				bytes: number;
			}>;
		}>
	> {
		const availableHashes = await this.prisma.available.findMany({
			where: {
				hash: { in: hashes },
				status: 'downloaded',
			},
			select: {
				hash: true,
				files: {
					select: {
						file_id: true,
						path: true,
						bytes: true,
					},
				},
			},
		});

		return availableHashes.map((record) => ({
			hash: record.hash,
			files: record.files.map((file) => ({
				file_id: file.file_id,
				path: file.path,
				bytes: Number(file.bytes),
			})),
		}));
	}

	public async removeAvailability(hash: string): Promise<void> {
		await this.prisma.available.delete({
			where: { hash },
		});
	}
}
