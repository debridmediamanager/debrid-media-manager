import { DatabaseClient } from './client';

interface LatestCast {
	url: string;
	link: string;
}

type EpisodeFilters = {
	season?: number;
	episode?: number;
};

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

function parseImdbId(imdbId: string): { baseImdbId: string } & EpisodeFilters {
	const [baseImdbId, seasonPart, episodePart] = imdbId.split(':');
	const season = seasonPart ? parseInt(seasonPart, 10) : undefined;
	const episode = episodePart ? parseInt(episodePart, 10) : undefined;
	return {
		baseImdbId,
		season: Number.isNaN(season) ? undefined : season,
		episode: Number.isNaN(episode) ? undefined : episode,
	};
}

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

function matchesEpisodeFilters(
	candidates: Array<string | undefined>,
	filters: EpisodeFilters
): boolean {
	if (filters.season === undefined && filters.episode === undefined) {
		return true;
	}

	for (const candidate of candidates) {
		if (!candidate) continue;
		const info = extractEpisodeInfo(candidate);
		if (!info) continue;

		if (filters.season !== undefined) {
			if (info.season === undefined || info.season !== filters.season) {
				continue;
			}
		}

		if (filters.episode !== undefined) {
			if (info.episode !== undefined && info.episode !== filters.episode) {
				continue;
			}
			if (info.episode === undefined) {
				if (!info.isSeasonPack) {
					continue;
				}
				if (filters.season === undefined || info.season !== filters.season) {
					continue;
				}
			}
		}

		return true;
	}

	return false;
}

export class CastService extends DatabaseClient {
	public async saveCastProfile(
		userId: string,
		clientId: string,
		clientSecret: string,
		refreshToken: string | null = null,
		movieMaxSize?: number,
		episodeMaxSize?: number,
		otherStreamsLimit?: number,
		hideCastOption?: boolean
	) {
		return this.prisma.castProfile.upsert({
			where: {
				userId: userId,
			},
			update: {
				clientId,
				clientSecret,
				refreshToken: refreshToken ?? undefined,
				...(movieMaxSize !== undefined && { movieMaxSize }),
				...(episodeMaxSize !== undefined && { episodeMaxSize }),
				...(otherStreamsLimit !== undefined && { otherStreamsLimit }),
				...(hideCastOption !== undefined && { hideCastOption }),
				updatedAt: new Date(),
			},
			create: {
				userId: userId,
				clientId,
				clientSecret,
				refreshToken: refreshToken ?? '',
				movieMaxSize: movieMaxSize ?? 0,
				episodeMaxSize: episodeMaxSize ?? 0,
				otherStreamsLimit: otherStreamsLimit ?? 5,
				hideCastOption: hideCastOption ?? false,
				updatedAt: new Date(),
			},
		});
	}

	public async getLatestCast(imdbId: string, userId: string): Promise<LatestCast | null> {
		const castItem = await this.prisma.cast.findFirst({
			where: {
				imdbId: imdbId,
				userId: userId,
			},
			orderBy: {
				updatedAt: 'desc',
			},
			select: {
				url: true,
				link: true,
			},
		});
		return castItem && castItem.url && castItem.link
			? { url: castItem.url, link: castItem.link }
			: null;
	}

	public async getCastURLs(
		imdbId: string,
		userId: string
	): Promise<{ url: string; link: string | null; size: number }[]> {
		const castItems = await this.prisma.cast.findMany({
			where: {
				imdbId: imdbId,
				userId: userId,
				updatedAt: {
					gt: new Date(new Date().getTime() - 30 * 24 * 60 * 60 * 1000), // 30 days
				},
			},
			orderBy: {
				updatedAt: 'desc',
			},
			select: {
				url: true,
				size: true,
				link: true,
			},
		});
		return castItems
			.filter(
				(item): item is { url: string; link: string; size: bigint } => item.link !== null
			)
			.map((item) => ({
				url: item.url,
				link: item.link,
				size: Number(item.size),
			}));
	}

	public async getCastProfile(userId: string): Promise<{
		clientId: string;
		clientSecret: string;
		refreshToken: string;
		movieMaxSize: number;
		episodeMaxSize: number;
		otherStreamsLimit?: number;
		hideCastOption?: boolean;
	} | null> {
		const profile = await this.prisma.castProfile.findUnique({
			where: { userId },
			select: {
				clientId: true,
				clientSecret: true,
				refreshToken: true,
				movieMaxSize: true,
				episodeMaxSize: true,
				otherStreamsLimit: true,
				hideCastOption: true,
			},
		});
		return profile;
	}

	public async saveCast(
		imdbId: string,
		userId: string,
		hash: string,
		url: string,
		rdLink: string,
		fileSize: number
	): Promise<void> {
		await this.prisma.cast.upsert({
			where: {
				imdbId_userId_hash: {
					imdbId: imdbId,
					userId: userId,
					hash: hash,
				},
			},
			update: {
				imdbId: imdbId,
				link: rdLink,
				url: url,
				size: BigInt(fileSize),
			},
			create: {
				imdbId: imdbId,
				userId: userId,
				hash: hash,
				link: rdLink,
				url: url,
				size: BigInt(fileSize),
			},
		});
	}

	public async fetchCastedMovies(userId: string): Promise<string[]> {
		const movies = await this.prisma.cast.findMany({
			where: {
				userId: userId,
				imdbId: {
					not: {
						contains: ':', // Excludes shows
					},
				},
			},
			orderBy: {
				updatedAt: 'desc',
			},
			distinct: ['imdbId'],
			select: {
				imdbId: true,
			},
		});

		return movies.map((movie) => movie.imdbId);
	}

	public async fetchCastedShows(userId: string): Promise<string[]> {
		const showsWithDuplicates = await this.prisma.cast.findMany({
			where: {
				userId: userId,
				imdbId: {
					contains: ':', // Includes only shows
				},
			},
			orderBy: {
				updatedAt: 'desc',
			},
			select: {
				imdbId: true,
			},
		});

		const uniqueShows = showsWithDuplicates
			.map((show) => show.imdbId.split(':')[0]) // Extracts the base imdbId of the show
			.filter((value, index, self) => self.indexOf(value) === index); // Ensures uniqueness

		return uniqueShows;
	}

	public async fetchAllCastedLinks(userId: string): Promise<
		{
			imdbId: string;
			url: string;
			hash: string;
			size: number;
			updatedAt: Date;
		}[]
	> {
		const castItems = await this.prisma.cast.findMany({
			where: {
				userId: userId,
			},
			select: {
				imdbId: true,
				url: true,
				hash: true,
				size: true,
				updatedAt: true,
			},
			orderBy: {
				updatedAt: 'desc',
			},
		});

		return castItems.map((item) => ({
			...item,
			size: Number(item.size),
		}));
	}

	// Returns false when there was no matching link, so callers can answer 404
	// instead of reporting a server error for something that simply isn't there.
	public async deleteCastedLink(imdbId: string, userId: string, hash: string): Promise<boolean> {
		try {
			const { count } = await this.prisma.cast.deleteMany({
				where: {
					imdbId,
					userId,
					hash,
				},
			});
			return count > 0;
		} catch (error: any) {
			throw new Error(`Failed to delete casted link: ${error.message}`);
		}
	}

	public async getAllUserCasts(userId: string): Promise<
		{
			imdbId: string;
			hash: string;
			url: string;
			link: string | null;
			size: number;
		}[]
	> {
		const casts = await this.prisma.cast.findMany({
			where: {
				userId: userId,
			},
			select: {
				imdbId: true,
				hash: true,
				url: true,
				link: true,
				size: true,
			},
		});
		return casts.map((cast) => ({
			imdbId: cast.imdbId,
			hash: cast.hash,
			url: cast.url,
			link: cast.link,
			size: Number(cast.size),
		}));
	}

	public async getUserCastStreams(
		imdbId: string,
		userId: string,
		limit: number = 5
	): Promise<
		{
			url: string;
			link: string;
			size: number;
			filename: string;
			hash: string;
		}[]
	> {
		const castItems = await this.prisma.cast.findMany({
			where: {
				imdbId: imdbId,
				userId: userId,
				link: {
					not: null,
				},
				updatedAt: {
					gt: new Date(new Date().getTime() - 30 * 24 * 60 * 60 * 1000),
				},
			},
			orderBy: {
				updatedAt: 'desc',
			},
			select: {
				url: true,
				link: true,
				size: true,
				hash: true,
			},
			take: limit,
		});

		return castItems
			.filter(
				(item): item is { url: string; link: string; size: bigint; hash: string } =>
					item.link !== null
			)
			.map((item) => ({
				url: item.url,
				link: item.link,
				size: Number(item.size),
				filename: item.url.split('/').pop() || 'Unknown',
				hash: item.hash,
			}));
	}

	public async getOtherStreams(
		imdbId: string,
		userId: string,
		limit: number = 5,
		maxSize?: number
	): Promise<
		{
			url: string;
			link: string;
			size: number;
			filename: string;
			hash: string;
		}[]
	> {
		if (limit <= 0) {
			return [];
		}

		const { baseImdbId, season: seasonFilter, episode: episodeFilter } = parseImdbId(imdbId);
		const hasEpisodeFilters = episodeFilter !== undefined || seasonFilter !== undefined;
		const hasMaxSize = typeof maxSize === 'number' && maxSize > 0;
		const normalizedMaxSizeMb = hasMaxSize ? Math.round(maxSize * 1024) : undefined;
		const maxSizeBytes =
			normalizedMaxSizeMb !== undefined
				? BigInt(normalizedMaxSizeMb) * BigInt(1024 * 1024)
				: undefined;
		const maxSizeCastLimit =
			normalizedMaxSizeMb !== undefined ? BigInt(normalizedMaxSizeMb) : undefined;

		const availableFileResults = await this.prisma.availableFile.findMany({
			where: {
				available: {
					imdbId: baseImdbId,
					status: 'downloaded',
				},
				...(maxSizeBytes !== undefined && { bytes: { lte: maxSizeBytes } }),
				...(seasonFilter !== undefined && { season: seasonFilter }),
				...(episodeFilter !== undefined && { episode: episodeFilter }),
			},
			select: {
				link: true,
				path: true,
				bytes: true,
				hash: true,
			},
			orderBy: {
				bytes: 'desc',
			},
			take: limit * 2,
		});

		const fileStreams = availableFileResults
			.filter((file) => file.link)
			.map((file) => ({
				url: file.link,
				link: file.link,
				size: Number(file.bytes) / 1024 / 1024,
				filename: file.path.split('/').pop() || file.path,
				hash: file.hash,
				source: 'file' as const,
			}));

		if (fileStreams.length >= limit) {
			return fileStreams.slice(0, limit);
		}

		const remainingAfterFiles = limit - fileStreams.length;

		const availableItems = await this.prisma.available.findMany({
			where: {
				imdbId: baseImdbId,
				status: 'downloaded',
				...(maxSizeBytes !== undefined && { bytes: { lte: maxSizeBytes } }),
				...(seasonFilter !== undefined && { season: seasonFilter }),
				...(episodeFilter !== undefined && { episode: episodeFilter }),
			},
			select: {
				hash: true,
				filename: true,
				files: {
					select: {
						link: true,
						path: true,
						bytes: true,
						season: true,
						episode: true,
					},
					orderBy: {
						bytes: 'desc',
					},
					take: 1,
				},
			},
			orderBy: {
				bytes: 'desc',
			},
			take: remainingAfterFiles * 2,
		});

		const torrentStreams = availableItems
			.filter((item) => {
				if (item.files.length === 0 || !item.files[0]?.link) {
					return false;
				}
				const file = item.files[0];
				if (!hasEpisodeFilters) {
					return true;
				}
				if (file.season !== null || file.episode !== null) {
					return false;
				}
				return true;
			})
			.map((item) => ({
				url: item.files[0].link,
				link: item.files[0].link,
				size: Number(item.files[0].bytes) / 1024 / 1024,
				filename: item.files[0].path.split('/').pop() || item.filename,
				hash: item.hash,
				source: 'torrent' as const,
			}));

		const combinedAvailable = [...fileStreams, ...torrentStreams];

		if (combinedAvailable.length >= limit) {
			return combinedAvailable.slice(0, limit);
		}

		const remainingLimit = limit - combinedAvailable.length;
		const castWhere = {
			imdbId: imdbId,
			link: {
				not: null,
			},
			size: {
				gt: 10,
				...(maxSizeCastLimit !== undefined && { lte: maxSizeCastLimit }),
			},
			userId: {
				not: userId,
			},
		};

		// Deduplicate by size in SQL rather than with Prisma's `distinct`: `distinct`
		// makes Prisma drop the SQL LIMIT and pull every cast row for the title (over
		// a thousand on popular ones) just to keep `remainingLimit` of them. groupBy
		// returns only the distinct sizes, then one bounded lookup per size fetches
		// the actual rows.
		const sizeGroups = await this.prisma.cast.groupBy({
			by: ['size'],
			where: castWhere,
			orderBy: {
				size: 'desc',
			},
			take: remainingLimit,
		});

		const otherCastItems = (
			await Promise.all(
				sizeGroups.map((group) =>
					this.prisma.cast.findFirst({
						where: { ...castWhere, size: group.size },
						select: {
							url: true,
							link: true,
							size: true,
							hash: true,
						},
					})
				)
			)
		).filter((item): item is NonNullable<typeof item> => item !== null);

		const castStreams = otherCastItems
			.filter(
				(item): item is { url: string; link: string; size: bigint; hash: string } =>
					item.link !== null
			)
			.map((item) => ({
				url: item.url,
				link: item.link,
				size: Number(item.size),
				filename: item.url.split('/').pop() || 'Unknown',
				hash: item.hash,
				source: 'cast' as const,
			}));

		const allStreams = [...combinedAvailable, ...castStreams]
			.sort((a, b) => b.size - a.size)
			.slice(0, limit);

		console.log('[CastService] Stream sources breakdown:', {
			imdbId,
			total: allStreams.length,
			fromFiles: allStreams.filter((s) => s.source === 'file').length,
			fromTorrents: allStreams.filter((s) => s.source === 'torrent').length,
			fromCast: allStreams.filter((s) => s.source === 'cast').length,
		});

		return allStreams.map(({ source, ...stream }) => stream);
	}
}
