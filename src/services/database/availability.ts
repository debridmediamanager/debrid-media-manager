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

	/**
	 * Persists Real-Debrid instant availability learned from Debridio's ⚡
	 * markers - the hash is in RD's shared cache, so any user adding it gets an
	 * instant download, but it is in nobody's account and has no real file list.
	 *
	 * The client marks a torrent rdAvailable only when at least one video file
	 * exists (an empty file list reads as `noVideos`), so each row gets one
	 * synthetic file. Its link is the `debridio:{hash}` marker: unique, never an
	 * RD URL, and it identifies the row as instant-only - real rows (transfer
	 * registrations, user downloads) keep their genuine file lists untouched.
	 * Rows already present are skipped entirely rather than refreshed; like real
	 * rows, an instant row is trusted until something deletes it.
	 */
	public async saveInstantAvailability(
		imdbId: string,
		rows: Array<{ hash: string; filename: string; bytes: number }>
	): Promise<number> {
		if (rows.length === 0) return 0;

		const existing = await this.prisma.available.findMany({
			where: { hash: { in: rows.map((row) => row.hash) } },
			select: { hash: true },
		});
		const knownHashes = new Set(existing.map((row) => row.hash));
		const fresh = rows.filter((row) => !knownHashes.has(row.hash));
		if (fresh.length === 0) return 0;

		const now = new Date();
		await this.prisma.available.createMany({
			data: fresh.map((row) => {
				const episodeInfo = extractEpisodeInfo(row.filename);
				return {
					hash: row.hash,
					imdbId,
					filename: row.filename,
					originalFilename: row.filename,
					bytes: BigInt(row.bytes),
					originalBytes: BigInt(row.bytes),
					host: 'real-debrid.com',
					progress: 100,
					status: 'downloaded',
					ended: now,
					season: episodeInfo?.season,
					episode: episodeInfo?.episode,
				};
			}),
			skipDuplicates: true,
		});
		await this.prisma.availableFile.createMany({
			data: fresh.map((row) => {
				const episodeInfo = extractEpisodeInfo(row.filename);
				return {
					link: `debridio:${row.hash}`,
					file_id: 0,
					hash: row.hash,
					path: row.filename,
					bytes: BigInt(row.bytes),
					season: episodeInfo?.season,
					episode: episodeInfo?.episode,
				};
			}),
			skipDuplicates: true,
		});
		return fresh.length;
	}

	/**
	 * The AllDebrid twin of saveInstantAvailability, for Debridio ⚡ markers
	 * scraped from the alldebrid addon config. The same marker-file trick, but
	 * on AvailableAd/AvailableAdFile with the statuses checkAvailabilityAd
	 * filters on: status 'Ready' and statusCode 4 (Ready on AllDebrid).
	 */
	public async saveInstantAvailabilityAd(
		imdbId: string,
		rows: Array<{ hash: string; filename: string; bytes: number }>
	): Promise<number> {
		if (rows.length === 0) return 0;

		const normalized = rows.map((row) => ({
			...row,
			hash: row.hash.toLowerCase(),
		}));
		const existing = await this.prisma.availableAd.findMany({
			where: { hash: { in: normalized.map((row) => row.hash) } },
			select: { hash: true },
		});
		const knownHashes = new Set(existing.map((row) => row.hash));
		const fresh = normalized.filter((row) => !knownHashes.has(row.hash));
		if (fresh.length === 0) return 0;

		const now = new Date();
		await this.prisma.availableAd.createMany({
			data: fresh.map((row) => {
				const episodeInfo = extractEpisodeInfo(row.filename);
				return {
					hash: row.hash,
					imdbId,
					filename: row.filename,
					originalFilename: row.filename,
					bytes: BigInt(row.bytes),
					originalBytes: BigInt(row.bytes),
					host: 'alldebrid.com',
					progress: 100,
					status: 'Ready',
					statusCode: 4,
					ended: now,
					season: episodeInfo?.season,
					episode: episodeInfo?.episode,
				};
			}),
			skipDuplicates: true,
		});
		await this.prisma.availableAdFile.createMany({
			data: fresh.map((row) => {
				const episodeInfo = extractEpisodeInfo(row.filename);
				return {
					link: `debridio:${row.hash}`,
					file_id: 0,
					hash: row.hash,
					path: row.filename,
					bytes: BigInt(row.bytes),
					season: episodeInfo?.season,
					episode: episodeInfo?.episode,
				};
			}),
			skipDuplicates: true,
		});
		return fresh.length;
	}

	// Refresh bookkeeping for the debridio integration, one Cache row per
	// ScrapedTrue key. The row's own updatedAt is the clock (the nzbSearchCache
	// pattern): saveInstantAvailability is create-only, so a refresh that finds
	// no new cached hashes writes nothing to Available and could never advance a
	// gate read from those rows - this row is what actually throttles.
	public async getDebridioRefreshedAt(key: string): Promise<Date | null> {
		const row = await this.prisma.cache.findUnique({
			where: { key: `debridio:refresh:${key}` },
			select: { updatedAt: true },
		});
		return row?.updatedAt ?? null;
	}

	public async markDebridioRefreshed(key: string): Promise<void> {
		await this.prisma.cache.upsert({
			where: { key: `debridio:refresh:${key}` },
			update: { value: {} },
			create: { key: `debridio:refresh:${key}`, value: {} },
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

	/**
	 * Removes the one file whose link RD says is gone.
	 *
	 * This used to delete the whole `Available` row, cascading every file in the
	 * torrent, for every user, on a single failed unrestrict - and the caller had
	 * no way to tell a dead link from RD's unrestrict throttle. One file's link
	 * rotting says nothing about its siblings, so only that row goes.
	 *
	 * Matched by prefix: links are stored in the 16-char form but a play request
	 * only ever carries the 13-char truncation, which is why the old exact-match
	 * lookup found nothing - 3,938,603 of 3,939,554 rows are the long form.
	 */
	public async removeAvailableFileByLinkPrefix(linkPrefix: string): Promise<number> {
		const { count } = await this.prisma.availableFile.deleteMany({
			where: { link: { startsWith: linkPrefix } },
		});
		return count;
	}

	public async getHashByLink(link: string): Promise<string | null> {
		const file = await this.prisma.availableFile.findFirst({
			where: { link: { startsWith: link } },
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
