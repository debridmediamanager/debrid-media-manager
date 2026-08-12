import { TorrentInfoResponse } from '../types';
import { DatabaseClient } from './client';

type ParsedEpisodeInfo = {
	season?: number;
	episode?: number;
	isSeasonPack?: boolean;
};

const EPISODE_PATTERNS: Array<{
	regex: RegExp;
	seasonIndex: number;
	episodeIndex: number;
}> = [
	{ regex: /s(\d{1,2})e(\d{1,2})/i, seasonIndex: 1, episodeIndex: 2 },
	{ regex: /(\d{1,2})x(\d{1,2})/i, seasonIndex: 1, episodeIndex: 2 },
	{
		regex: /season[^\d]{0,6}(\d{1,2}).*episode[^\d]{0,6}(\d{1,2})/i,
		seasonIndex: 1,
		episodeIndex: 2,
	},
	{
		regex: /episode[^\d]{0,6}(\d{1,2}).*season[^\d]{0,6}(\d{1,2})/i,
		seasonIndex: 2,
		episodeIndex: 1,
	},
];

const SEASON_ONLY_PATTERNS: Array<{ regex: RegExp; captureIndex?: number }> = [
	{ regex: /season[^\d]{0,6}(\d{1,2})/i, captureIndex: 1 },
	{ regex: /(^|[^a-z0-9])s(\d{1,2})(?![a-z0-9])/i, captureIndex: 2 },
];

function extractEpisodeInfo(text: string): ParsedEpisodeInfo | null {
	for (const pattern of EPISODE_PATTERNS) {
		const match = pattern.regex.exec(text);
		if (match) {
			const season = parseInt(match[pattern.seasonIndex], 10);
			const episode = parseInt(match[pattern.episodeIndex], 10);
			if (!Number.isNaN(season) && !Number.isNaN(episode)) {
				return { season, episode };
			}
		}
	}

	for (const pattern of SEASON_ONLY_PATTERNS) {
		const match = pattern.regex.exec(text);
		if (match) {
			const captureIndex = pattern.captureIndex ?? 1;
			const season = parseInt(match[captureIndex], 10);
			if (!Number.isNaN(season)) {
				return { season, isSeasonPack: true };
			}
		}
	}

	return null;
}

export class AvailabilityService extends DatabaseClient {
	public async getIMDBIdByHash(hash: string): Promise<string | null> {
		const available = await this.prisma.available.findFirst({
			where: { hash },
			select: { imdbId: true },
		});
		return available?.imdbId || null;
	}

	public async saveIMDBIdMapping(hash: string, imdbId: string): Promise<void> {
		await this.prisma.available.upsert({
			where: { hash },
			update: { imdbId },
			create: {
				hash,
				imdbId,
				filename: hash,
				originalFilename: hash,
				bytes: BigInt(0),
				originalBytes: BigInt(0),
				host: 'real-debrid.com',
				progress: 100,
				status: 'user_mapped',
				ended: new Date(),
			},
		});
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

		const candidates = [torrentInfo.filename, torrentInfo.original_filename];
		if (selectedFiles.length > 0) {
			candidates.push(selectedFiles[0].path);
		}

		let episodeInfo: ParsedEpisodeInfo | null = null;
		for (const candidate of candidates) {
			if (candidate) {
				episodeInfo = extractEpisodeInfo(candidate);
				if (episodeInfo) {
					break;
				}
			}
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
			season: episodeInfo?.season,
			episode: episodeInfo?.episode,
		};

		await this.prisma.available.upsert({
			where: { hash },
			update: {
				...baseData,
				files:
					selectedFiles.length > 0
						? {
								deleteMany: {},
								create: selectedFiles.map((file, index) => {
									const fileEpisodeInfo = extractEpisodeInfo(file.path);
									return {
										link: torrentInfo.links?.[index] || '',
										file_id: file.id,
										path: file.path,
										bytes: BigInt(file.bytes || 0),
										season: fileEpisodeInfo?.season,
										episode: fileEpisodeInfo?.episode,
									};
								}),
							}
						: undefined,
			},
			create: {
				...baseData,
				files:
					selectedFiles.length > 0
						? {
								create: selectedFiles.map((file, index) => {
									const fileEpisodeInfo = extractEpisodeInfo(file.path);
									return {
										link: torrentInfo.links?.[index] || '',
										file_id: file.id,
										path: file.path,
										bytes: BigInt(file.bytes || 0),
										season: fileEpisodeInfo?.season,
										episode: fileEpisodeInfo?.episode,
									};
								}),
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
		const candidates = [filename, originalFilename];
		if (selectedFiles.length > 0) {
			candidates.push(selectedFiles[0].path);
		}

		let episodeInfo: ParsedEpisodeInfo | null = null;
		for (const candidate of candidates) {
			if (candidate) {
				episodeInfo = extractEpisodeInfo(candidate);
				if (episodeInfo) {
					break;
				}
			}
		}

		return this.prisma.available.upsert({
			where: {
				hash: hash,
			},
			update: {
				imdbId,
				originalFilename,
				originalBytes: BigInt(originalBytes),
				ended: new Date(ended),
				season: episodeInfo?.season,
				episode: episodeInfo?.episode,
				files: {
					deleteMany: {},
					create: selectedFiles.map((file, index) => {
						const fileEpisodeInfo = extractEpisodeInfo(file.path);
						return {
							link: links[index],
							file_id: file.id,
							path: file.path,
							bytes: BigInt(file.bytes),
							season: fileEpisodeInfo?.season,
							episode: fileEpisodeInfo?.episode,
						};
					}),
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
				season: episodeInfo?.season,
				episode: episodeInfo?.episode,
				files: {
					create: selectedFiles.map((file, index) => {
						const fileEpisodeInfo = extractEpisodeInfo(file.path);
						return {
							link: links[index],
							file_id: file.id,
							path: file.path,
							bytes: BigInt(file.bytes),
							season: fileEpisodeInfo?.season,
							episode: fileEpisodeInfo?.episode,
						};
					}),
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

	public async getHashByLink(link: string): Promise<string | null> {
		const file = await this.prisma.availableFile.findUnique({
			where: { link },
			select: { hash: true },
		});
		return file?.hash || null;
	}

	// ====================================================================
	// AllDebrid Availability Methods
	// ====================================================================

	public async upsertAvailabilityAd({
		hash,
		imdbId,
		filename,
		size,
		status,
		statusCode,
		completionDate,
		files,
	}: {
		hash: string;
		imdbId: string;
		filename: string;
		size: number;
		status: string;
		statusCode: number;
		completionDate: number;
		files: Array<{ n: string; s: number; l: string }>;
	}) {
		// Normalize hash to lowercase (AllDebrid returns lowercase hashes)
		const normalizedHash = hash.toLowerCase();
		const episodeInfo = extractEpisodeInfo(filename);

		return this.prisma.availableAd.upsert({
			where: { hash: normalizedHash },
			update: {
				imdbId,
				filename,
				originalFilename: filename,
				bytes: BigInt(size),
				originalBytes: BigInt(size),
				host: 'alldebrid.com',
				progress: 100,
				status,
				statusCode,
				ended: new Date(completionDate * 1000),
				season: episodeInfo?.season,
				episode: episodeInfo?.episode,
				verifiedAt: new Date(),
				verificationCount: { increment: 1 },
				files: {
					deleteMany: {},
					create: files.map((file, index) => {
						const fileEpisodeInfo = extractEpisodeInfo(file.n);
						return {
							link: file.l,
							file_id: index,
							path: file.n,
							bytes: BigInt(file.s),
							season: fileEpisodeInfo?.season,
							episode: fileEpisodeInfo?.episode,
						};
					}),
				},
			},
			create: {
				hash: normalizedHash,
				imdbId,
				filename,
				originalFilename: filename,
				bytes: BigInt(size),
				originalBytes: BigInt(size),
				host: 'alldebrid.com',
				progress: 100,
				status,
				statusCode,
				ended: new Date(completionDate * 1000),
				season: episodeInfo?.season,
				episode: episodeInfo?.episode,
				files: {
					create: files.map((file, index) => {
						const fileEpisodeInfo = extractEpisodeInfo(file.n);
						return {
							link: file.l,
							file_id: index,
							path: file.n,
							bytes: BigInt(file.s),
							season: fileEpisodeInfo?.season,
							episode: fileEpisodeInfo?.episode,
						};
					}),
				},
			},
		});
	}

	public async checkAvailabilityAd(
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
		const availableHashes = await this.prisma.availableAd.findMany({
			where: {
				imdbId,
				hash: { in: hashes.map((h) => h.toLowerCase()) }, // AllDebrid returns lowercase
				status: 'Ready', // AllDebrid uses "Ready" not "downloaded"
				statusCode: 4, // Extra verification
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

	// Hash-only counterpart to checkAvailabilityAd, for callers with no IMDb ID
	// to scope by (the hashlist page). `hash` is unique on availableAd, so
	// dropping the imdbId filter cannot widen a row into several.
	public async checkAvailabilityAdByHashes(hashes: string[]): Promise<
		Array<{
			hash: string;
			files: Array<{
				file_id: number;
				path: string;
				bytes: number;
			}>;
		}>
	> {
		const availableHashes = await this.prisma.availableAd.findMany({
			where: {
				hash: { in: hashes.map((h) => h.toLowerCase()) }, // AllDebrid returns lowercase
				status: 'Ready', // AllDebrid uses "Ready" not "downloaded"
				statusCode: 4, // Extra verification
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

	public async removeAvailabilityAd(hash: string): Promise<void> {
		await this.prisma.availableAd.delete({
			where: { hash: hash.toLowerCase() },
		});
	}

	public async getIMDBIdByHashAd(hash: string): Promise<string | null> {
		const available = await this.prisma.availableAd.findFirst({
			where: { hash: hash.toLowerCase() },
			select: { imdbId: true },
		});
		return available?.imdbId || null;
	}
}
