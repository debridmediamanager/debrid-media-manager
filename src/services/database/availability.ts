import type { Prisma } from '@prisma/client';
import { isVideo } from '../../utils/selectable';
import { clipToVarchar } from '../../utils/varchar';
import { TorrentInfoResponse } from '../types';
import { DatabaseClient } from './client';

/**
 * A Debridio marker stands for a cached video stream, but its path is whatever name Debridio
 * gave, often a release title with no extension (8,204 RD rows, 2026-11-05), so it counts as
 * playable on its own. It is flagged to the page rather than its link sent.
 */
const isMarker = (link: string) => link.startsWith('debridio:');

const playableHashes = (rows: { hash: string; files: { path: string; link: string }[] }[]) =>
	new Set(
		rows
			.filter((row) => row.files.some((f) => isVideo(f) || isMarker(f.link)))
			.map((row) => row.hash.toLowerCase())
	);

/** A file as the title pages read it. */
const pageFile = (file: { file_id: number; path: string; bytes: bigint; link: string }) => ({
	file_id: file.file_id,
	path: file.path,
	bytes: Number(file.bytes),
	...(isMarker(file.link) ? { marker: true as const } : {}),
});

const EXECUTABLE = /\.(exe|scr|msi|bat|cmd|lnk|vbs|pif)$/i;

/** A torrent cached on Real-Debrid, as `upsertAvailability` records it. */
export interface AvailabilityUpsert {
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
}

/** The two names an `Available` row records for a torrent; see `getCachedRdNames`. */
export interface RdCachedNames {
	filename: string;
	originalFilename: string;
}

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
	// `S01E105` is episode 105; two digits read it as 10
	{ regex: /s(\d{1,2})e(\d{1,4})(?!\d)/i, seasonIndex: 1, episodeIndex: 2 },
	// `1x05`, never `1920x1080` or `1x264`: a digit before, or a third digit after, makes it a
	// resolution or a codec
	{ regex: /(?<!\d)(\d{1,2})x(\d{2})(?!\d)/i, seasonIndex: 1, episodeIndex: 2 },
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

export function extractEpisodeInfo(text: string): ParsedEpisodeInfo | null {
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

/** The links AllDebrid hands out for a file; a Debridio marker or a missing link is not one. */
const AD_LINK_PREFIX = 'https://alldebrid.com/f/';

/** `Cache` keys marking a release removed from `Available`; see `removeAvailability`. */
const EVICTED_PREFIX = 'avevicted:';
/** The same for `AvailableAd`, left when its last dead file takes the release with it. */
export const AD_EVICTED_PREFIX = 'adevicted:';

/**
 * A file's season and episode from its own name first, then its whole path: a folder named
 * `Show.S01E01-E10` would otherwise file every episode inside it as E01.
 */
export function episodeOfFile(path: string): ParsedEpisodeInfo | null {
	const name = path.split('/').pop() ?? path;
	return extractEpisodeInfo(name) ?? extractEpisodeInfo(path);
}

export class AvailabilityService extends DatabaseClient {
	public async getIMDBIdByHash(hash: string): Promise<string | null> {
		const available = await this.prisma.available.findFirst({
			where: { hash },
			select: { imdbId: true },
		});
		return available?.imdbId || null;
	}

	/**
	 * A title for a hash nobody has recorded yet, typed by a member casting it from a library.
	 * An existing row keeps its title: a cast from another provider's library must not move a
	 * Real-Debrid release off the page everybody else finds it on.
	 */
	public async saveIMDBIdMapping(hash: string, imdbId: string): Promise<void> {
		await this.prisma.available.upsert({
			where: { hash },
			update: {},
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
									const fileEpisodeInfo = episodeOfFile(file.path);
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
									const fileEpisodeInfo = episodeOfFile(file.path);
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

	/**
	 * Records a torrent as cached on Real-Debrid, with its files.
	 *
	 * Both names are cut to their `varchar(191)` columns here rather than left to
	 * every caller: a longer one fails the whole insert. Pass `client` to write
	 * inside a transaction the caller holds (see `Repository.fileTransferRelease`).
	 */
	public async upsertAvailability(
		{
			hash,
			imdbId,
			filename: fullFilename,
			originalFilename: fullOriginalFilename,
			bytes,
			originalBytes,
			host,
			progress,
			status,
			ended,
			selectedFiles,
			links,
		}: AvailabilityUpsert,
		client: Prisma.TransactionClient = this.prisma
	) {
		const filename = clipToVarchar(fullFilename);
		const originalFilename = clipToVarchar(fullOriginalFilename);
		const candidates = [fullFilename, fullOriginalFilename];
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

		return client.available.upsert({
			where: {
				hash: hash,
			},
			// The first title stays: re-adding a release from another page (a sequel listed on
			// the original's) or a forged post must not move it for everybody. Everything else
			// is what Real-Debrid says now, which also turns a `user_mapped` placeholder cached.
			update: {
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
					deleteMany: {},
					create: selectedFiles.map((file, index) => {
						const fileEpisodeInfo = episodeOfFile(file.path);
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
						const fileEpisodeInfo = episodeOfFile(file.path);
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
	 * Anything that plays a row's link has to ask for Real-Debrid links only, as
	 * the RD Cast stream pool (`CastService.getOtherStreams`) does.
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
		const fresh = await this.notEvicted(
			rows.filter((row) => !knownHashes.has(row.hash)),
			EVICTED_PREFIX
		);
		if (fresh.length === 0) return 0;

		const now = new Date();
		// one transaction: a release without its marker file reads uncached and is never redone
		await this.prisma.$transaction([
			this.prisma.available.createMany({
				data: fresh.map((row) => {
					const episodeInfo = extractEpisodeInfo(row.filename);
					return {
						hash: row.hash,
						imdbId,
						// one name past the column failed the whole batch for that title
						filename: clipToVarchar(row.filename),
						originalFilename: clipToVarchar(row.filename),
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
			}),
			this.prisma.availableFile.createMany({
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
			}),
		]);
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
		const fresh = await this.notEvicted(
			normalized.filter((row) => !knownHashes.has(row.hash)),
			AD_EVICTED_PREFIX
		);
		if (fresh.length === 0) return 0;

		const now = new Date();
		await this.prisma.$transaction([
			this.prisma.availableAd.createMany({
				data: fresh.map((row) => {
					const episodeInfo = extractEpisodeInfo(row.filename);
					return {
						hash: row.hash,
						imdbId,
						// one name past the column failed the whole batch for that title
						filename: clipToVarchar(row.filename),
						originalFilename: clipToVarchar(row.filename),
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
			}),
			this.prisma.availableAdFile.createMany({
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
			}),
		]);
		return fresh.length;
	}

	/** `rows` without the releases a tombstone under `prefix` says were removed. */
	private async notEvicted<T extends { hash: string }>(rows: T[], prefix: string): Promise<T[]> {
		if (rows.length === 0) return rows;
		const stones = await this.prisma.cache.findMany({
			where: { key: { in: rows.map((row) => `${prefix}${row.hash.toLowerCase()}`) } },
			select: { key: true },
		});
		const gone = new Set(stones.map((stone) => stone.key.slice(prefix.length)));
		return rows.filter((row) => !gone.has(row.hash.toLowerCase()));
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
				marker?: true;
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
						link: true,
					},
				},
			},
		});

		return availableHashes.map((record) => ({
			hash: record.hash,
			files: record.files.map(pageFile),
		}));
	}

	public async checkAvailabilityByHashes(hashes: string[]): Promise<
		Array<{
			hash: string;
			/** RD's names for the torrent; see `getCachedRdNames`. */
			filename: string;
			originalFilename: string;
			files: Array<{
				file_id: number;
				path: string;
				bytes: number;
				marker?: true;
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
				filename: true,
				originalFilename: true,
				files: {
					select: {
						file_id: true,
						path: true,
						bytes: true,
						link: true,
					},
				},
			},
		});

		return availableHashes.map((record) => ({
			hash: record.hash,
			filename: record.filename,
			originalFilename: record.originalFilename,
			files: record.files.map(pageFile),
		}));
	}

	/**
	 * Which of these hashes Real-Debrid already holds, with the two names its
	 * row records for each, and no file rows.
	 *
	 * `checkAvailability` pulls every file row of every match, which is what a
	 * page rendering a file list needs and pure weight for a caller that only
	 * wants to know whether a grab would be instant. The Torznab feed asks this
	 * of a whole title's hash list at once, so the file rows would dominate it.
	 *
	 * The names are here because RD refuses some releases by name whether it
	 * holds them or not, so "held" alone does not answer "would a grab land".
	 * On a row written from RD's own torrent info, `originalFilename` is RD's
	 * `original_filename`, the torrent's own name, which RD judges an add on, and
	 * `filename` is the name of what was selected, the file's own name when that
	 * is one file, which RD judges an unrestrict on. Rows filed from debridio or
	 * by the uploader carry a file name or the rewritten name in both.
	 *
	 * Keyed in lower case: the hash column collates case-insensitively, so a
	 * row can come back in a different case from the hash that was asked for,
	 * and a caller comparing sets would silently miss it.
	 */
	public async getCachedRdNames(hashes: string[]): Promise<Map<string, RdCachedNames>> {
		if (hashes.length === 0) return new Map();
		const rows = await this.prisma.available.findMany({
			where: { hash: { in: hashes }, status: 'downloaded' },
			select: { hash: true, filename: true, originalFilename: true },
		});
		return new Map(
			rows.map((row) => [
				row.hash.toLowerCase(),
				{ filename: row.filename, originalFilename: row.originalFilename },
			])
		);
	}

	/**
	 * Which of these hashes AllDebrid already holds, for the same callers as
	 * `getCachedRdNames`. Its rows carry AD's own ready state, not RD's — same
	 * pair of conditions `checkAvailabilityAd` uses.
	 */
	public async filterCachedHashesAd(hashes: string[]): Promise<Set<string>> {
		if (hashes.length === 0) return new Set();
		const rows = await this.prisma.availableAd.findMany({
			where: {
				hash: { in: hashes.map((hash) => hash.toLowerCase()) },
				status: 'Ready',
				statusCode: 4,
			},
			select: { hash: true },
		});
		return new Set(rows.map((row) => row.hash.toLowerCase()));
	}

	/**
	 * Which of these hashes Real-Debrid holds with at least one playable video —
	 * the answer the hashlist page's "Show Instant" filter needs, and nothing
	 * more. `checkAvailabilityByHashes` answers the same question but ships
	 * every file row to the browser to decide it there; a 28k-item list made
	 * that 278 requests of 100 hashes. Only `path` is read, since `isVideo`
	 * needs nothing else. Answered in lower case, like `getCachedRdNames`.
	 */
	public async filterPlayableCachedHashes(hashes: string[]): Promise<Set<string>> {
		if (hashes.length === 0) return new Set();
		const rows = await this.prisma.available.findMany({
			where: { hash: { in: hashes }, status: 'downloaded' },
			select: { hash: true, files: { select: { path: true, link: true } } },
		});
		return playableHashes(rows);
	}

	/**
	 * Hashes RD or AllDebrid has cached whose every file is an executable. These
	 * are fake releases: a video-looking name over a ~1 GB padded .exe. AD counts
	 * on its own: on 2026-10-18 eight fakes on two film pages were cached only there.
	 */
	public async filterExecutableOnlyHashes(hashes: string[]): Promise<Set<string>> {
		if (hashes.length === 0) return new Set();
		const query = {
			where: { hash: { in: hashes.map((hash) => hash.toLowerCase()) } },
			select: { hash: true, files: { select: { path: true } } },
		};
		const [rd, ad] = await Promise.all([
			this.prisma.available.findMany(query),
			this.prisma.availableAd.findMany(query),
		]);
		return new Set(
			[...rd, ...ad]
				.filter(
					(row) => row.files.length > 0 && row.files.every((f) => EXECUTABLE.test(f.path))
				)
				.map((row) => row.hash.toLowerCase())
		);
	}

	/** The AllDebrid counterpart of `filterPlayableCachedHashes`. */
	public async filterPlayableCachedHashesAd(hashes: string[]): Promise<Set<string>> {
		if (hashes.length === 0) return new Set();
		const rows = await this.prisma.availableAd.findMany({
			where: {
				hash: { in: hashes.map((hash) => hash.toLowerCase()) },
				status: 'Ready',
				statusCode: 4,
			},
			select: { hash: true, files: { select: { path: true, link: true } } },
		});
		return playableHashes(rows);
	}

	/**
	 * Forget a release and its files; one already gone (another user's removal) is no error.
	 * It leaves a tombstone, so filing a finished transfer (the reconcile cron re-files any
	 * missing from here, forever) cannot bring back a release proven uncached.
	 */
	public async removeAvailability(hash: string): Promise<void> {
		await this.prisma.$transaction([
			this.prisma.availableFile.deleteMany({ where: { hash } }),
			this.prisma.available.deleteMany({ where: { hash } }),
			this.tombstone(hash),
		]);
	}

	private tombstone(hash: string) {
		const key = `${EVICTED_PREFIX}${hash.toLowerCase()}`;
		const value = { at: Date.now() };
		return this.prisma.cache.upsert({
			where: { key },
			update: { value },
			create: { key, value },
		});
	}

	/** Whether this release was removed as uncached or dead (`removeAvailability`). */
	public async wasAvailabilityEvicted(hash: string): Promise<boolean> {
		const row = await this.prisma.cache.findUnique({
			where: { key: `${EVICTED_PREFIX}${hash.toLowerCase()}` },
			select: { key: true },
		});
		return row !== null;
	}

	/**
	 * Removes the one file whose link RD says is gone.
	 *
	 * This used to delete the whole `Available` row, cascading every file in the
	 * torrent, for every user, on a single failed unrestrict - and the caller had
	 * no way to tell a dead link from RD's unrestrict throttle. One file's link
	 * rotting says nothing about its siblings, so only that row goes.
	 *
	 * Matched by prefix: stored links can include an account binding (current
	 * 16-char or historical longer ids), while playback uses the 13-char key.
	 * An exact match would miss those bound links.
	 */
	public async removeAvailableFileByLinkPrefix(linkPrefix: string): Promise<number> {
		const where = { link: { startsWith: linkPrefix } };
		const dead = await this.prisma.availableFile.findMany({ where, select: { hash: true } });
		const { count } = await this.prisma.availableFile.deleteMany({ where });
		// A release with no file left serves nothing, though readers that only ask whether a
		// row exists (Torznab /cached, zurg search, the sponsor API) would go on saying cached.
		for (const hash of new Set(dead.map((file) => file.hash))) {
			if ((await this.prisma.availableFile.count({ where: { hash } })) === 0) {
				await this.removeAvailability(hash);
			}
		}
		return count;
	}

	public async getHashByLink(link: string): Promise<string | null> {
		const match = link.match(
			/^https:\/\/real-debrid\.com\/d\/([A-Za-z0-9]{13})(?:[A-Za-z0-9]{3}|[A-Za-z0-9]{13})?$/
		);
		if (!match) return null;
		const prefix = `https://real-debrid.com/d/${match[1]}`;
		const files = await this.prisma.availableFile.findMany({
			where: { link: { startsWith: prefix } },
			select: { hash: true, link: true },
		});
		let hash: string | null = null;
		for (const file of files) {
			if (
				!/^https:\/\/real-debrid\.com\/d\/[A-Za-z0-9]{13}(?:[A-Za-z0-9]{3}|[A-Za-z0-9]{13})?$/.test(
					file.link
				)
			)
				return null;
			const candidate = file.hash.toLowerCase();
			if (hash !== null && hash !== candidate) return null;
			hash = candidate;
		}
		return hash;
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
		// A successful non-Ready observation supersedes an earlier cache hit.
		// Do not create availability entries for downloads we have never seen Ready.
		if (statusCode !== 4 || status !== 'Ready') {
			await this.prisma.$transaction([
				this.prisma.availableAd.updateMany({
					where: { hash: normalizedHash },
					data: { status, statusCode },
				}),
				this.prisma.availableAdFile.deleteMany({ where: { hash: normalizedHash } }),
			]);
			return;
		}

		const episodeInfo = extractEpisodeInfo(filename);
		// `link` keys the file table, so a file sent without one gets a key of its own
		const fileRows = files.map((file, index) => {
			const fileEpisodeInfo = episodeOfFile(file.n);
			return {
				link: file.l || `adnolink:${normalizedHash}:${index}`,
				file_id: index,
				path: file.n,
				bytes: BigInt(file.s),
				season: fileEpisodeInfo?.season,
				episode: fileEpisodeInfo?.episode,
			};
		});
		// A release already Ready with real links keeps them: AllDebrid cannot be asked from
		// here, and Stremio serves these links under the release's title, so a sighting may
		// confirm a release but not swap its links. A regressed magnet's dead links go with
		// the not-Ready report above, and the next Ready sighting brings fresh ones.
		const existing = await this.prisma.availableAd.findUnique({
			where: { hash: normalizedHash },
			select: {
				status: true,
				files: {
					where: { link: { startsWith: AD_LINK_PREFIX } },
					select: { link: true },
					take: 1,
				},
			},
		});
		const keepFiles = existing?.status === 'Ready' && existing.files.length > 0;

		const name = clipToVarchar(filename);
		return this.prisma.availableAd.upsert({
			where: { hash: normalizedHash },
			// the first title stays, as for Real-Debrid (`upsertAvailability`)
			update: {
				filename: name,
				originalFilename: name,
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
				...(keepFiles ? {} : { files: { deleteMany: {}, create: fileRows } }),
			},
			create: {
				hash: normalizedHash,
				imdbId,
				filename: name,
				originalFilename: name,
				bytes: BigInt(size),
				originalBytes: BigInt(size),
				host: 'alldebrid.com',
				progress: 100,
				status,
				statusCode,
				ended: new Date(completionDate * 1000),
				season: episodeInfo?.season,
				episode: episodeInfo?.episode,
				files: { create: fileRows },
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
				marker?: true;
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
						link: true,
					},
				},
			},
		});

		return availableHashes.map((record) => ({
			hash: record.hash,
			files: record.files.map(pageFile),
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
				marker?: true;
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
						link: true,
					},
				},
			},
		});

		return availableHashes.map((record) => ({
			hash: record.hash,
			files: record.files.map(pageFile),
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

	// ====================================================================
	// Debrid-Link Availability Methods
	// ====================================================================

	/** Record a Debrid-Link release seen whole, replacing what an earlier sighting listed. */
	public async upsertAvailabilityDl({
		hash,
		imdbId,
		filename,
		files,
	}: {
		hash: string;
		imdbId: string;
		filename: string;
		files: Array<{ path: string; bytes: number }>;
	}) {
		const normalizedHash = hash.toLowerCase();
		const episodeInfo = extractEpisodeInfo(filename);
		const rows = files.map((file, index) => {
			const fileEpisodeInfo = episodeOfFile(file.path);
			return {
				file_id: index,
				path: file.path,
				bytes: BigInt(file.bytes),
				season: fileEpisodeInfo?.season,
				episode: fileEpisodeInfo?.episode,
			};
		});
		const fields = {
			filename,
			bytes: BigInt(files.reduce((sum, f) => sum + f.bytes, 0)),
			season: episodeInfo?.season ?? null,
			episode: episodeInfo?.episode ?? null,
		};
		return this.prisma.availableDl.upsert({
			where: { hash: normalizedHash },
			// the first title stays, as for Real-Debrid (`upsertAvailability`)
			update: { ...fields, files: { deleteMany: {}, create: rows } },
			create: { hash: normalizedHash, imdbId, ...fields, files: { create: rows } },
		});
	}

	/** Recorded Debrid-Link releases among `hashes`, under `imdbId` when one is given. */
	public async checkAvailabilityDl(
		hashes: string[],
		imdbId?: string
	): Promise<
		Array<{ hash: string; files: Array<{ file_id: number; path: string; bytes: number }> }>
	> {
		const rows = await this.prisma.availableDl.findMany({
			where: {
				...(imdbId ? { imdbId } : {}),
				hash: { in: hashes.map((h) => h.toLowerCase()) },
			},
			select: {
				hash: true,
				files: { select: { file_id: true, path: true, bytes: true } },
			},
		});
		return rows.map((row) => ({
			hash: row.hash,
			files: row.files.map((file) => ({
				file_id: file.file_id,
				path: file.path,
				bytes: Number(file.bytes),
			})),
		}));
	}

	/** Forget a Debrid-Link release an add found uncached; a hash with no row is no error. */
	public async removeAvailabilityDl(hash: string): Promise<void> {
		await this.prisma.availableDl.deleteMany({ where: { hash: hash.toLowerCase() } });
	}
}
