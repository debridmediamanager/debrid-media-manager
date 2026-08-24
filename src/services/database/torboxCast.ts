import { stripTorBoxToken } from '@/utils/torboxLinkSecret';
import { DatabaseClient } from './client';

interface LatestCast {
	url: string;
	link: string;
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
		// The URL TorBox hands back carries the caller's raw API key as a query
		// parameter. Nothing reads the column back - playback re-mints from
		// torrentId/fileId, and the listing never selects it - so the key does
		// not need storing.
		const link = stripTorBoxToken(tbLink);

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
				link,
				url: url,
				size: BigInt(fileSize),
				torrentId: torrentId,
				fileId: fileId,
			},
			create: {
				imdbId: imdbId,
				userId: userId,
				hash: hash,
				link,
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

	// Returns false when there was no matching link, so callers can answer 404
	// instead of reporting a server error for something that simply isn't there.
	public async deleteCastedLink(imdbId: string, userId: string, hash: string): Promise<boolean> {
		try {
			const { count } = await this.prisma.torBoxCast.deleteMany({
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
		if (limit <= 0) {
			return [];
		}

		const hasMaxSize = typeof maxSize === 'number' && maxSize > 0;
		const normalizedMaxSizeMb = hasMaxSize ? Math.round(maxSize * 1024) : undefined;
		const maxSizeCastLimit =
			normalizedMaxSizeMb !== undefined ? BigInt(normalizedMaxSizeMb) : undefined;

		const where = {
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

		// For TorBox, we only get streams from other TorBox Cast users
		// (We don't have availability tables for TorBox yet)
		//
		// Deduplicate by size in SQL rather than with Prisma's `distinct`: `distinct`
		// makes Prisma drop the SQL LIMIT and pull every row for the title (hundreds
		// on popular ones) just to keep `limit` of them. groupBy returns only the
		// distinct sizes, then one bounded lookup per size fetches the actual rows.
		const sizeGroups = await this.prisma.torBoxCast.groupBy({
			by: ['size'],
			where,
			orderBy: {
				size: 'desc',
			},
			take: limit,
		});

		const otherCastItems = (
			await Promise.all(
				sizeGroups.map((group) =>
					this.prisma.torBoxCast.findFirst({
						where: { ...where, size: group.size },
						select: {
							url: true,
							link: true,
							size: true,
							hash: true,
							torrentId: true,
							fileId: true,
						},
					})
				)
			)
		).filter((item): item is NonNullable<typeof item> => item !== null);

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
