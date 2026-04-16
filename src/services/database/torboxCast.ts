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

export class TorBoxCastService extends DatabaseClient {
	public async saveCastProfile(
		userId: string,
		apiKey: string,
		movieMaxSize?: number,
		episodeMaxSize?: number,
		otherStreamsLimit?: number,
		hideCastOption?: boolean
	) {
		return this.prisma.torBoxCastProfile.upsert({
			where: {
				userId: userId,
			},
			update: {
				apiKey,
				...(movieMaxSize !== undefined && { movieMaxSize }),
				...(episodeMaxSize !== undefined && { episodeMaxSize }),
				...(otherStreamsLimit !== undefined && { otherStreamsLimit }),
				...(hideCastOption !== undefined && { hideCastOption }),
				updatedAt: new Date(),
			},
			create: {
				userId: userId,
				apiKey,
				movieMaxSize: movieMaxSize ?? 0,
				episodeMaxSize: episodeMaxSize ?? 0,
				otherStreamsLimit: otherStreamsLimit ?? 5,
				hideCastOption: hideCastOption ?? false,
				updatedAt: new Date(),
			},
		});
	}

	public async getLatestCast(imdbId: string, userId: string): Promise<LatestCast | null> {
		const castItem = await this.prisma.torBoxCast.findFirst({
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
		const castItems = await this.prisma.torBoxCast.findMany({
			where: {
				imdbId: imdbId,
				userId: userId,
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

	public async getOtherCastURLs(
		imdbId: string,
		userId: string
	): Promise<{ url: string; link: string; size: number }[]> {
		const castItems = await this.prisma.torBoxCast.findMany({
			where: {
				imdbId: imdbId,
				link: {
					not: null,
				},
				size: {
					gt: 10,
				},
				userId: {
					not: userId,
				},
			},
			distinct: ['size'],
			orderBy: {
				updatedAt: 'desc',
			},
			take: 2,
			select: {
				url: true,
				link: true,
				size: true,
			},
		});

		return castItems
			.filter((item): item is { url: string; link: string; size: bigint } => !!item.link)
			.map((item) => ({
				url: item.url,
				link: item.link,
				size: Number(item.size),
			}));
	}

	public async getCastProfile(userId: string): Promise<{
		apiKey: string;
		movieMaxSize: number;
		episodeMaxSize: number;
		otherStreamsLimit?: number;
		hideCastOption?: boolean;
	} | null> {
		const profile = await this.prisma.torBoxCastProfile.findUnique({
			where: { userId },
			select: {
				apiKey: true,
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
		tbLink: string,
		fileSize: number,
		torrentId?: number,
		fileId?: number
	): Promise<void> {
		await this.prisma.torBoxCast.upsert({
			where: {
				imdbId_userId_hash: {
					imdbId: imdbId,
					userId: userId,
					hash: hash,
				},
			},
			update: {
				imdbId: imdbId,
				link: tbLink,
				url: url,
				size: BigInt(fileSize),
				torrentId: torrentId,
				fileId: fileId,
			},
			create: {
				imdbId: imdbId,
				userId: userId,
				hash: hash,
				link: tbLink,
				url: url,
				size: BigInt(fileSize),
				torrentId: torrentId,
				fileId: fileId,
			},
		});
	}

	public async fetchCastedMovies(userId: string): Promise<string[]> {
		const movies = await this.prisma.torBoxCast.findMany({
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
		const showsWithDuplicates = await this.prisma.torBoxCast.findMany({
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
		const castItems = await this.prisma.torBoxCast.findMany({
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

	public async deleteCastedLink(imdbId: string, userId: string, hash: string): Promise<void> {
		try {
			await this.prisma.torBoxCast.delete({
				where: {
					imdbId_userId_hash: {
						imdbId,
						userId,
						hash,
					},
				},
			});
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
		const casts = await this.prisma.torBoxCast.findMany({
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
			torrentId: number | null;
			fileId: number | null;
		}[]
	> {
		const castItems = await this.prisma.torBoxCast.findMany({
			where: {
				imdbId: imdbId,
				userId: userId,
				link: {
					not: null,
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
				torrentId: true,
				fileId: true,
			},
			take: limit,
		});

		return castItems
			.filter(
				(
					item
				): item is {
					url: string;
					link: string;
					size: bigint;
					hash: string;
					torrentId: number | null;
					fileId: number | null;
				} => item.link !== null
			)
			.map((item) => ({
				url: item.url,
				link: item.link,
				size: Number(item.size),
				filename: item.url.split('/').pop() || 'Unknown',
				hash: item.hash,
				torrentId: item.torrentId,
				fileId: item.fileId,
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
			torrentId: number | null;
			fileId: number | null;
		}[]
	> {
		const { baseImdbId, season: seasonFilter, episode: episodeFilter } = parseImdbId(imdbId);
		const hasMaxSize = typeof maxSize === 'number' && maxSize > 0;
		const normalizedMaxSizeMb = hasMaxSize ? Math.round(maxSize * 1024) : undefined;
		const maxSizeCastLimit =
			normalizedMaxSizeMb !== undefined ? BigInt(normalizedMaxSizeMb) : undefined;

		// For TorBox, we only get streams from other TorBox Cast users
		// (We don't have availability tables for TorBox yet)
		const otherCastItems = await this.prisma.torBoxCast.findMany({
			where: {
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
			},
			distinct: ['size'],
			orderBy: {
				size: 'desc',
			},
			select: {
				url: true,
				link: true,
				size: true,
				hash: true,
				torrentId: true,
				fileId: true,
			},
			take: limit,
		});

		const castStreams = otherCastItems
			.filter(
				(
					item
				): item is {
					url: string;
					link: string;
					size: bigint;
					hash: string;
					torrentId: number | null;
					fileId: number | null;
				} => item.link !== null
			)
			.map((item) => ({
				url: item.url,
				link: item.link,
				size: Number(item.size),
				filename: item.url.split('/').pop() || 'Unknown',
				hash: item.hash,
				torrentId: item.torrentId,
				fileId: item.fileId,
			}));

		console.log('[TorBoxCastService] Stream sources breakdown:', {
			imdbId,
			total: castStreams.length,
			fromCast: castStreams.length,
		});

		return castStreams;
	}
}
