import { DatabaseClient } from './client';

interface LatestCast {
	url: string;
	link: string;
}

export class TorrinCastService extends DatabaseClient {
	public async saveCastProfile(
		userId: string,
		baseUrl: string,
		apiKey: string,
		movieMaxSize?: number,
		episodeMaxSize?: number,
		otherStreamsLimit?: number,
		hideCastOption?: boolean
	) {
		return this.prisma.torrinCastProfile.upsert({
			where: {
				userId: userId,
			},
			update: {
				baseUrl,
				apiKey,
				...(movieMaxSize !== undefined && { movieMaxSize }),
				...(episodeMaxSize !== undefined && { episodeMaxSize }),
				...(otherStreamsLimit !== undefined && { otherStreamsLimit }),
				...(hideCastOption !== undefined && { hideCastOption }),
				updatedAt: new Date(),
			},
			create: {
				userId: userId,
				baseUrl,
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
		const castItem = await this.prisma.torrinCast.findFirst({
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
		const castItems = await this.prisma.torrinCast.findMany({
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
		const castItems = await this.prisma.torrinCast.findMany({
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
		baseUrl: string;
		apiKey: string;
		movieMaxSize: number;
		episodeMaxSize: number;
		otherStreamsLimit?: number;
		hideCastOption?: boolean;
	} | null> {
		const profile = await this.prisma.torrinCastProfile.findUnique({
			where: { userId },
			select: {
				baseUrl: true,
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
		link: string,
		fileSize: number
	): Promise<void> {
		await this.prisma.torrinCast.upsert({
			where: {
				imdbId_userId_hash: {
					imdbId: imdbId,
					userId: userId,
					hash: hash,
				},
			},
			update: {
				imdbId: imdbId,
				link: link,
				url: url,
				size: BigInt(fileSize),
			},
			create: {
				imdbId: imdbId,
				userId: userId,
				hash: hash,
				link: link,
				url: url,
				size: BigInt(fileSize),
			},
		});
	}

	public async fetchCastedMovies(userId: string): Promise<string[]> {
		const movies = await this.prisma.torrinCast.findMany({
			where: {
				userId: userId,
				imdbId: {
					not: {
						contains: ':',
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
		const showsWithDuplicates = await this.prisma.torrinCast.findMany({
			where: {
				userId: userId,
				imdbId: {
					contains: ':',
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
			.map((show) => show.imdbId.split(':')[0])
			.filter((value, index, self) => self.indexOf(value) === index);

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
		const castItems = await this.prisma.torrinCast.findMany({
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
			await this.prisma.torrinCast.delete({
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
		const casts = await this.prisma.torrinCast.findMany({
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
		const castItems = await this.prisma.torrinCast.findMany({
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
		const hasMaxSize = typeof maxSize === 'number' && maxSize > 0;
		const normalizedMaxSizeMb = hasMaxSize ? Math.round(maxSize * 1024) : undefined;
		const maxSizeCastLimit =
			normalizedMaxSizeMb !== undefined ? BigInt(normalizedMaxSizeMb) : undefined;

		const otherCastItems = await this.prisma.torrinCast.findMany({
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
			},
			take: limit,
		});

		return otherCastItems
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
}
